// Bot-API: die Schnittstelle, über die der Copilot-Studio-Agent das Portal
// bedient.
//
// Der Unterschied zum Rest des Backends ist der Aufrufer. Hier ruft kein
// angemeldeter Mensch aus dem Browser, sondern ein Dienst aus dem M365-Tenant,
// der die Person nur behauptet. Deshalb:
//
//  - Die Verbindung selbst wird über ein eigenes Token geprüft (`BOT_API_TOKEN`),
//    nicht über eine Benutzeranmeldung. Ohne Token antwortet die Schnittstelle
//    gar nicht — sie fällt zu, nicht auf.
//  - Die Freigabeprüfung bleibt dieselbe wie im Portal: `decisionProblem`
//    entscheidet, nicht der Agent. Ein Vier-Augen-Auftrag ist über den Bot
//    nicht freigebbar, weil die behauptete Person dort keine zweite ist.
//  - Kein Modelltext wird Befehl. Der Agent wählt nichts aus; er stößt die
//    Diagnose an, und welche Aktionen das sind, steht hier fest.
//
// Alles Veränderliche kommt von außen herein (`store`, `resolveDevice`, …),
// damit die Schnittstelle ohne Gerät, ohne Agent und ohne Jira prüfbar ist.

const crypto = require('crypto');
const express = require('express');

const { parseDisk, parseMemory, summarise } = require('./diagnose');
const cards = require('./cards');

// Lesende Prüfungen einer Diagnose. Reihenfolge ist egal, sie laufen parallel.
const DIAGNOSE_STEPS = [
  { key: 'disk', action: 'get_disk_space', title: 'Systemlaufwerk', parse: parseDisk },
  { key: 'memory', action: 'get_memory', title: 'Arbeitsspeicher', parse: parseMemory }
];

// Was das Portal von sich aus vorschlägt, wenn eine Prüfung anschlägt. Nur der
// erste Treffer wird vorgeschlagen: eine Freigabe-Anfrage auf einmal, sonst
// klickt niemand mehr bewusst.
const REMEDIES = [
  {
    when: (r) => r.disk?.status === 'warning',
    action: 'clear_journal_logs',
    description: 'Systemprotokolle älter als sieben Tage bereinigen — gibt Platz auf dem Systemlaufwerk frei.'
  }
];

// Angabe für den Chat, nicht für die Planung: der Agent-Lauf dauert so lange,
// wie der Befehl dauert, und das weiß vorher niemand.
const ESTIMATED_DURATION = 'wenige Minuten';

// Wie lange eine lesende Prüfung warten darf. Copilot Studio bricht nach 30 s
// ab — zwei Prüfungen parallel mit je 12 s lassen Luft für die Antwort.
const READ_TIMEOUT_MS = 12_000;

// Diagnoseläufe, damit `/status/:id` auch für einen Lauf antwortet und nicht nur
// für einen einzelnen Auftrag. Im Speicher und begrenzt — wie Aufträge und
// Geräte im übrigen Prototyp.
const MAX_RUNS = 200;

function sameSecret(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length === 0 || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function bearer(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

/**
 * Baut den Router.
 *
 * @param {{
 *   store: any,
 *   decisionProblem: Function,
 *   rank: Function,
 *   portalTools: any,
 *   jiraReady: () => boolean,
 *   resolveDevice: (deviceId?: string) => Promise<any>,
 *   actionRisk: (action: string) => string | undefined,
 *   token?: string,
 *   readTimeoutMs?: number
 * }} deps
 */
function createBotRouter(deps) {
  const {
    store, decisionProblem, rank, portalTools, jiraReady, resolveDevice, actionRisk,
    token = process.env.BOT_API_TOKEN || '',
    readTimeoutMs = READ_TIMEOUT_MS
  } = deps;

  const router = express.Router();
  const runs = new Map();

  function rememberRun(run) {
    runs.set(run.id, run);
    // Älteste zuerst: Map hält die Einfügereihenfolge.
    while (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value);
  }

  router.use((req, res, next) => {
    if (!token) {
      return res.status(503).json({ error: 'Bot-API ist nicht konfiguriert (BOT_API_TOKEN fehlt).' });
    }
    if (!sameSecret(bearer(req), token)) {
      return res.status(401).json({ error: 'Bot-Token ungültig.' });
    }
    next();
  });

  // --------------------------------------------------------------- Diagnose

  router.post('/diagnose', async (req, res) => {
    const { deviceId, userId } = req.body || {};
    if (typeof userId !== 'string' || !userId.trim()) {
      return res.status(400).json({ error: 'Feld "userId" fehlt.' });
    }

    const device = await resolveDevice(deviceId);

    // Ohne Geräte-Agenten gibt es keine Diagnose. Ein nur über baramundi
    // verwaltetes Gerät zählt hier wie keins: eine JobInstance liefert keine
    // Rohausgabe, es gibt also nichts auszuwerten (docs/BARAMUNDI.md).
    if (!device || (device.driver && device.driver !== 'local')) {
      const results = {
        agent: {
          title: 'Agent',
          connected: false,
          status: 'warning',
          label: !device
            ? (deviceId ? `Gerät ${deviceId} ist nicht angemeldet` : 'Kein Gerät zugeordnet')
            : `Gerät ${device.deviceId} wird über baramundi verwaltet — dort ist keine Diagnose möglich`
        }
      };
      return res.json({
        jobId: null,
        deviceId: device?.deviceId || null,
        results,
        pendingApproval: null,
        card: cards.diagnoseCard({ deviceId: device?.deviceId || deviceId, results })
      });
    }

    // Aufträge anlegen und parallel auf die Ergebnisse warten. Jeder Auftrag
    // steht so im Audit-Log wie ein aus dem Portal angestoßener.
    const finished = await Promise.all(
      DIAGNOSE_STEPS.map(async (step) => {
        const job = store.createJob({
          deviceId: device.deviceId,
          driver: 'local',
          action: step.action,
          params: {},
          risk: 'read',
          requestedBy: userId,
          reason: 'Diagnose über Teams'
        });
        return { step, job: await store.waitForResult(job.id, readTimeoutMs) };
      })
    );

    const results = {};
    for (const { step, job } of finished) {
      results[step.key] = job && job.status === 'done'
        ? { title: step.title, ...step.parse(job.output) }
        : {
            title: step.title,
            used: null,
            status: 'unknown',
            label: job?.error || 'Prüfung ohne Ergebnis abgebrochen.'
          };
    }
    results.agent = { title: 'Agent', connected: true, status: 'ok', label: 'Agent verbunden' };

    const remedy = REMEDIES.find((r) => r.when(results) && actionRisk(r.action));
    let pendingApproval = null;
    if (remedy) {
      const job = store.createJob({
        deviceId: device.deviceId,
        driver: 'local',
        action: remedy.action,
        params: {},
        risk: actionRisk(remedy.action),
        requestedBy: userId,
        reason: 'Vorschlag aus der Diagnose über Teams'
      });
      pendingApproval = {
        id: job.id,
        action: job.action,
        description: remedy.description,
        risk: job.risk,
        card: cards.approvalCard({
          approvalId: job.id,
          deviceId: device.deviceId,
          description: remedy.description,
          risk: job.risk
        })
      };
    }

    const run = {
      id: crypto.randomUUID(),
      deviceId: device.deviceId,
      userId,
      results,
      approvalId: pendingApproval?.id || null,
      jobIds: finished.map(({ job }) => job?.id).filter(Boolean),
      createdAt: new Date().toISOString()
    };
    rememberRun(run);
    store.audit('bot.diagnose', {
      runId: run.id,
      deviceId: run.deviceId,
      by: userId,
      findings: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.status])),
      approvalId: run.approvalId
    });

    res.json({
      jobId: run.id,
      deviceId: run.deviceId,
      results,
      pendingApproval,
      card: cards.diagnoseCard({ deviceId: run.deviceId, results })
    });
  });

  // --------------------------------------------------------------- Freigabe

  router.post('/approve/:id', (req, res) => {
    const { userId, confirmed } = req.body || {};
    if (typeof userId !== 'string' || !userId.trim()) {
      return res.status(400).json({ error: 'Feld "userId" fehlt.' });
    }

    const pending = store.getJob(req.params.id);
    if (!pending) return res.status(404).json({ error: 'Auftrag unbekannt.' });
    if (pending.status !== 'awaiting_approval') {
      return res.status(409).json({ error: `Auftrag ist nicht offen (${pending.status}).`, status: pending.status });
    }
    // Aufträge fremder Treiber führt die Portalroute selbst aus. Über den Bot
    // freigegeben blieben sie in der Warteschlange liegen und niemand merkte es.
    if (pending.driver && pending.driver !== 'local') {
      return res.status(409).json({
        error: 'Dieser Auftrag läuft über baramundi und wird im Portal freigegeben.'
      });
    }

    // Dieselbe Regel wie im Portal. Der Bot behauptet eine Person; mehr als die
    // Rolle `user` darf er daraus nicht machen, sonst wäre das Vier-Augen-Prinzip
    // über Teams umgehbar.
    const problem = decisionProblem({ id: userId, role: 'user' }, pending, rank);
    if (problem) return res.status(403).json({ error: problem });

    if (confirmed === false) {
      const denied = store.denyJob(req.params.id, userId);
      return res.json({
        status: denied.status,
        jobId: denied.id,
        card: cards.statusCard({ jobId: denied.id, status: denied.status, summary: 'Nichts verändert.' })
      });
    }

    const job = store.approveJob(req.params.id, userId);
    store.audit('bot.approved', { jobId: job.id, action: job.action, by: userId });
    res.json({
      status: job.status,
      jobId: job.id,
      estimatedDuration: ESTIMATED_DURATION,
      card: cards.statusCard({
        jobId: job.id,
        status: job.status,
        summary: `Freigegeben. Ausführung dauert ${ESTIMATED_DURATION}.`
      })
    });
  });

  // ------------------------------------------------------------------ Stand

  router.get('/status/:id', (req, res) => {
    const job = store.getJob(req.params.id);
    if (job) {
      const summary = ['done', 'error'].includes(job.status) ? summarise(job) : null;
      return res.json({
        status: job.status,
        exitCode: job.exitCode,
        summary,
        card: cards.statusCard({ jobId: job.id, status: job.status, summary })
      });
    }

    const run = runs.get(req.params.id);
    if (run) {
      return res.json({
        status: 'done',
        results: run.results,
        approvalId: run.approvalId,
        card: cards.diagnoseCard({ deviceId: run.deviceId, results: run.results })
      });
    }

    res.status(404).json({ error: 'Vorgang unbekannt.' });
  });

  // -------------------------------------------------------------- Eskalation

  router.post('/ticket', async (req, res) => {
    if (!jiraReady()) return res.status(503).json({ error: 'Jira ist nicht konfiguriert.' });
    const { summary, description, userId, sessionId, deviceId } = req.body || {};
    if (typeof userId !== 'string' || !userId.trim()) {
      return res.status(400).json({ error: 'Feld "userId" fehlt.' });
    }

    try {
      // Derselbe Zähler wie im Portal: pro Gespräch ein Vorgang, auch wenn der
      // Agent hartnäckig nachfragt.
      const { ticket, reused } = await portalTools.createTicketOnce({
        summary,
        description,
        sessionId: sessionId || `teams:${userId}`,
        context: {
          Melder: userId,
          Gerät: deviceId || 'nicht angegeben',
          Kanal: 'Microsoft Teams'
        }
      });
      if (!reused) {
        store.audit('bot.ticket.created', { key: ticket.key, by: userId, deviceId: deviceId || null });
      }
      res.status(reused ? 200 : 201).json({
        key: ticket.key,
        url: ticket.url,
        reused,
        card: cards.ticketCard({ key: ticket.key, url: ticket.url, summary, reused })
      });
    } catch (err) {
      res.status(/zu kurz/.test(err.message) ? 400 : 502).json({ error: err.message });
    }
  });

  return router;
}

module.exports = {
  createBotRouter, DIAGNOSE_STEPS, REMEDIES, ESTIMATED_DURATION, READ_TIMEOUT_MS, sameSecret
};
