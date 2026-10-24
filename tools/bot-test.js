#!/usr/bin/env node
//
// Prüft die Bot-API, über die Copilot Studio das Portal bedient — gegen einen
// echten HTTP-Server, aber mit nachgebauter Auftragsverwaltung. So sind Token,
// Statuscodes, Freigaberegel und Adaptive Cards ohne Gerät und ohne Jira
// prüfbar, und die Prüfung liefe auch gegen eine spätere Postgres-Ablage.

const path = require('path');
const crypto = require('crypto');

const BACKEND = path.join(__dirname, '..', 'backend');
const express = require(path.join(BACKEND, 'node_modules', 'express'));
const { createBotRouter } = require(path.join(BACKEND, 'bot.js'));
const { decisionProblem } = require(path.join(BACKEND, 'approval.js'));
const { rank } = require(path.join(BACKEND, 'roles.js'));
const { ACTIONS } = require(path.join(BACKEND, 'actions.js'));

// Wie in approval-test.js: eine Prüfaktion für fremde Konten, damit die
// Vier-Augen-Regel geprüft bleibt, auch wenn gerade keine ausgerollte Aktion
// sie nutzt.
ACTIONS.__pruefung_vier_augen = { risk: 'write', fourEyes: true };

const TOKEN = 'geheim-fuer-den-test';

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.error(`  FEHL ${name}${detail ? ' — ' + detail : ''}`);
  }
}

// --- Nachbau der Auftragsverwaltung -----------------------------------------

function fakeStore({ outputs = {}, fail = {} } = {}) {
  const jobs = new Map();
  const events = [];

  return {
    jobs,
    events,
    audit: (event, detail) => events.push({ event, ...detail }),
    createJob({ deviceId, action, params, risk, requestedBy, reason, driver = 'local' }) {
      const job = {
        id: crypto.randomUUID(),
        deviceId, driver, action, params: params || {}, risk,
        reason: reason || null,
        requestedBy,
        status: risk === 'write' ? 'awaiting_approval' : 'queued',
        output: null,
        exitCode: null
      };
      jobs.set(job.id, job);
      events.push({ event: 'job.created', jobId: job.id, action, risk, requestedBy });
      return job;
    },
    async waitForResult(id) {
      const job = jobs.get(id);
      if (fail[job.action]) {
        job.status = 'error';
        job.error = fail[job.action];
        return job;
      }
      job.status = 'done';
      job.exitCode = 0;
      job.output = outputs[job.action] ?? '';
      return job;
    },
    getJob: (id) => jobs.get(id) || null,
    approveJob(id, by) {
      const job = jobs.get(id);
      if (!job || job.status !== 'awaiting_approval') return job || null;
      job.status = 'queued';
      job.approvedBy = by;
      return job;
    },
    denyJob(id, by) {
      const job = jobs.get(id);
      if (!job || job.status !== 'awaiting_approval') return job || null;
      job.status = 'denied';
      job.deniedBy = by;
      return job;
    }
  };
}

const DF_VOLL = '/dev/sda1 100G 94G 6,0G 94% /';
const DF_LEER = '/dev/sda1 100G 42G 58G 42% /';
const FREE = 'Mem: 7,7Gi 3,0Gi 4,0Gi';

function fakeJira() {
  const angelegt = [];
  return {
    angelegt,
    async createTicketOnce({ summary, sessionId }) {
      const vorhanden = angelegt.find((t) => t.sessionId === sessionId);
      if (vorhanden) return { ticket: vorhanden.ticket, reused: true };
      const ticket = { key: `IT-${4520 + angelegt.length + 1}`, url: 'https://bfs.example/IT', summary };
      angelegt.push({ sessionId, ticket });
      return { ticket, reused: false };
    }
  };
}

/** Startet einen Server mit dem Router und gibt ein `rufen()` dazu zurück. */
async function starten({ store, device = { deviceId: 'NB-FIN-0427', driver: 'local', online: true },
                         token = TOKEN, jira = fakeJira(), jiraReady = () => true } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/bot', createBotRouter({
    store,
    decisionProblem,
    rank,
    portalTools: jira,
    jiraReady,
    actionRisk: (action) => ACTIONS[action]?.risk,
    resolveDevice: async (deviceId) => (deviceId && device && deviceId !== device.deviceId ? null : device),
    token,
    readTimeoutMs: 1000
  }));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/bot`;

  const rufen = async (method, pfad, body, bearer = TOKEN) => {
    const res = await fetch(base + pfad, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let json = null;
    try { json = await res.json(); } catch { /* leere Antwort ist auch ein Befund */ }
    return { code: res.status, body: json };
  };

  return { rufen, jira, schliessen: () => new Promise((r) => server.close(r)) };
}

// --- Token -------------------------------------------------------------------

async function pruefeToken() {
  console.log('Token');
  const ohne = await starten({ store: fakeStore(), token: '' });
  const a = await ohne.rufen('POST', '/diagnose', { userId: 'anna@bfs.de' });
  check('ohne BOT_API_TOKEN antwortet die Schnittstelle nicht', a.code === 503, JSON.stringify(a));
  await ohne.schliessen();

  const mit = await starten({ store: fakeStore({ outputs: { get_disk_space: DF_LEER, get_memory: FREE } }) });
  check('falsches Token: 401', (await mit.rufen('POST', '/diagnose', { userId: 'a' }, 'falsch')).code === 401);
  check('gar kein Token: 401', (await mit.rufen('POST', '/diagnose', { userId: 'a' }, null)).code === 401);
  check('leeres Token: 401', (await mit.rufen('POST', '/diagnose', { userId: 'a' }, '')).code === 401);
  check('richtiges Token: kein 401', (await mit.rufen('POST', '/diagnose', { userId: 'a' })).code === 200);
  await mit.schliessen();
}

// --- Diagnose ----------------------------------------------------------------

async function pruefeDiagnose() {
  console.log('\nDiagnose');
  const store = fakeStore({ outputs: { get_disk_space: DF_VOLL, get_memory: FREE } });
  const srv = await starten({ store });

  check('ohne userId: 400', (await srv.rufen('POST', '/diagnose', {})).code === 400);

  const { code, body } = await srv.rufen('POST', '/diagnose', { deviceId: 'NB-FIN-0427', userId: 'anna@bfs.de' });
  check('Diagnose antwortet 200', code === 200, JSON.stringify(body));
  check('Platte wird gewarnt', body.results.disk.status === 'warning' && body.results.disk.used === 94);
  check('Speicher ist ok', body.results.memory.status === 'ok');
  check('Agent gilt als verbunden', body.results.agent.connected === true);
  check('Lauf-Kennung kommt zurück', typeof body.jobId === 'string' && body.jobId.length > 10);
  check('Freigabe wird vorgeschlagen', body.pendingApproval?.action === 'clear_journal_logs',
    JSON.stringify(body.pendingApproval));
  check('Vorschlag ist schreibend', body.pendingApproval?.risk === 'write');
  check('Vorschlag hat eine Beschreibung', /Systemprotokolle/.test(body.pendingApproval?.description || ''));
  check('Karte ist eine AdaptiveCard', body.card?.type === 'AdaptiveCard');
  check('Karte nennt das Gerät', JSON.stringify(body.card).includes('NB-FIN-0427'));
  check('Karte zeigt die Warnung', JSON.stringify(body.card).includes('94% belegt'));
  check('Freigabekarte hat zwei Knöpfe', body.pendingApproval.card.actions.length === 2);
  check('Knöpfe tragen die Auftrags-Kennung',
    body.pendingApproval.card.actions.every((a) => a.data.approvalId === body.pendingApproval.id));
  check('Karte enthält keinen Befehlstext',
    !/journalctl|powershell/i.test(JSON.stringify(body.pendingApproval.card)));

  check('lesende Aufträge stehen im Protokoll',
    store.events.filter((e) => e.event === 'job.created' && e.risk === 'read').length === 2);
  check('der Vorschlag wartet auf Freigabe',
    store.getJob(body.pendingApproval.id).status === 'awaiting_approval');
  check('Diagnose steht im Audit-Log', store.events.some((e) => e.event === 'bot.diagnose'));
  check('Audit nennt die Person',
    store.events.find((e) => e.event === 'bot.diagnose').by === 'anna@bfs.de');
  check('Aufträge gehören der Person',
    [...store.jobs.values()].every((j) => j.requestedBy === 'anna@bfs.de'));
  await srv.schliessen();

  const ruhig = await starten({ store: fakeStore({ outputs: { get_disk_space: DF_LEER, get_memory: FREE } }) });
  const o = (await ruhig.rufen('POST', '/diagnose', { userId: 'anna@bfs.de' })).body;
  check('ohne Befund kein Freigabevorschlag', o.pendingApproval === null, JSON.stringify(o.pendingApproval));
  check('ohne deviceId wird ein Gerät gewählt', o.deviceId === 'NB-FIN-0427');
  await ruhig.schliessen();

  const kaputt = await starten({
    store: fakeStore({ outputs: { get_memory: FREE }, fail: { get_disk_space: 'Zeitüberschreitung' } })
  });
  const k = (await kaputt.rufen('POST', '/diagnose', { userId: 'anna@bfs.de' })).body;
  check('abgebrochene Prüfung ist unknown', k.results.disk.status === 'unknown');
  check('Fehlermeldung steht im Satz', k.results.disk.label === 'Zeitüberschreitung');
  check('keine erfundene Zahl', k.results.disk.used === null);
  check('und kein Vorschlag auf Verdacht', k.pendingApproval === null);
  await kaputt.schliessen();

  const ohneGeraet = await starten({ store: fakeStore(), device: null });
  const g = await ohneGeraet.rufen('POST', '/diagnose', { userId: 'anna@bfs.de' });
  check('ohne Gerät trotzdem eine Antwort', g.code === 200);
  check('Agent gilt als nicht verbunden', g.body.results.agent.connected === false);
  check('ohne Gerät kein Vorschlag', g.body.pendingApproval === null);
  await ohneGeraet.schliessen();

  const fremd = await starten({ store: fakeStore() });
  const f = await fremd.rufen('POST', '/diagnose', { deviceId: 'NB-FREMD-1', userId: 'anna@bfs.de' });
  check('unbekanntes Gerät wird nicht erfunden', f.body.results.agent.connected === false);
  await fremd.schliessen();

  // Nur über baramundi verwaltete Geräte haben keinen Agenten — und eine
  // JobInstance liefert keine Rohausgabe, die auszuwerten wäre.
  const bconnectStore = fakeStore();
  const bc = await starten({
    store: bconnectStore,
    device: { deviceId: 'PC-BMS-1', driver: 'bconnect', online: true }
  });
  const b = await bc.rufen('POST', '/diagnose', { userId: 'anna@bfs.de' });
  check('baramundi-Gerät: keine Diagnose', b.code === 200 && b.body.results.agent.connected === false,
    JSON.stringify(b.body.results));
  check('baramundi-Gerät: Grund wird genannt', /baramundi/.test(b.body.results.agent.label));
  check('baramundi-Gerät: kein Auftrag angelegt', bconnectStore.jobs.size === 0);
  await bc.schliessen();
}

// --- Freigabe ----------------------------------------------------------------

async function pruefeFreigabe() {
  console.log('\nFreigabe');
  const store = fakeStore({ outputs: { get_disk_space: DF_VOLL, get_memory: FREE } });
  const srv = await starten({ store });
  const erste = (await srv.rufen('POST', '/diagnose', { userId: 'anna@bfs.de' })).body;
  const id = erste.pendingApproval.id;

  check('unbekannter Auftrag: 404', (await srv.rufen('POST', '/approve/gibtsnicht', { userId: 'anna@bfs.de' })).code === 404);
  check('ohne userId: 400', (await srv.rufen('POST', `/approve/${id}`, {})).code === 400);

  const fremd = await srv.rufen('POST', `/approve/${id}`, { userId: 'ben@bfs.de' });
  check('fremde Person darf nicht freigeben', fremd.code === 403, JSON.stringify(fremd));
  check('Auftrag wartet weiter', store.getJob(id).status === 'awaiting_approval');

  const ja = await srv.rufen('POST', `/approve/${id}`, { userId: 'anna@bfs.de', confirmed: true });
  check('eigene Freigabe wird angenommen', ja.code === 200, JSON.stringify(ja));
  check('Auftrag ist eingereiht', ja.body.status === 'queued' && store.getJob(id).status === 'queued');
  check('Freigebende Person steht am Auftrag', store.getJob(id).approvedBy === 'anna@bfs.de');
  check('Dauer wird genannt', typeof ja.body.estimatedDuration === 'string');
  check('Freigabe steht im Audit-Log', store.events.some((e) => e.event === 'bot.approved' && e.jobId === id));

  const nochmal = await srv.rufen('POST', `/approve/${id}`, { userId: 'anna@bfs.de', confirmed: true });
  check('zweite Freigabe: 409', nochmal.code === 409, JSON.stringify(nochmal));
  await srv.schliessen();

  // Ablehnen
  const store2 = fakeStore({ outputs: { get_disk_space: DF_VOLL, get_memory: FREE } });
  const srv2 = await starten({ store: store2 });
  const zweite = (await srv2.rufen('POST', '/diagnose', { userId: 'anna@bfs.de' })).body;
  const nein = await srv2.rufen('POST', `/approve/${zweite.pendingApproval.id}`,
    { userId: 'anna@bfs.de', confirmed: false });
  check('Ablehnen wird angenommen', nein.code === 200 && nein.body.status === 'denied', JSON.stringify(nein));
  check('abgelehnter Auftrag läuft nicht', store2.getJob(zweite.pendingApproval.id).status === 'denied');
  await srv2.schliessen();

  // Fremde Treiber: im Portal freigeben, nicht über den Bot — sonst bliebe der
  // Auftrag in der Warteschlange liegen, weil niemand ihn ausführt.
  const store4 = fakeStore();
  const srv4 = await starten({ store: store4 });
  const bcJob = store4.createJob({
    deviceId: 'PC-BMS-1', driver: 'bconnect', action: 'restart_service',
    risk: 'write', requestedBy: 'anna@bfs.de'
  });
  const bcAntwort = await srv4.rufen('POST', `/approve/${bcJob.id}`, { userId: 'anna@bfs.de', confirmed: true });
  check('baramundi-Auftrag über den Bot: 409', bcAntwort.code === 409, JSON.stringify(bcAntwort));
  check('und er wartet weiter', store4.getJob(bcJob.id).status === 'awaiting_approval');
  await srv4.schliessen();

  // Vier-Augen: über Teams nicht freigebbar, weil der Bot nur eine Person behauptet.
  const store3 = fakeStore();
  const srv3 = await starten({ store: store3 });
  const vierAugen = store3.createJob({
    deviceId: 'NB-FIN-0427', action: '__pruefung_vier_augen', risk: 'write', requestedBy: 'anna@bfs.de'
  });
  const v = await srv3.rufen('POST', `/approve/${vierAugen.id}`, { userId: 'anna@bfs.de', confirmed: true });
  check('Vier-Augen-Aktion über den Bot: 403', v.code === 403, JSON.stringify(v));
  check('auch nicht für eine andere behauptete Person',
    (await srv3.rufen('POST', `/approve/${vierAugen.id}`, { userId: 'ben@bfs.de', confirmed: true })).code === 403);
  check('der Auftrag wartet weiter', store3.getJob(vierAugen.id).status === 'awaiting_approval');
  await srv3.schliessen();
}

// --- Stand -------------------------------------------------------------------

async function pruefeStand() {
  console.log('\nStand');
  const store = fakeStore({ outputs: { get_disk_space: DF_VOLL, get_memory: FREE } });
  const srv = await starten({ store });
  const lauf = (await srv.rufen('POST', '/diagnose', { userId: 'anna@bfs.de' })).body;

  const run = await srv.rufen('GET', `/status/${lauf.jobId}`);
  check('Lauf-Kennung liefert die Befunde', run.code === 200 && run.body.results.disk.used === 94,
    JSON.stringify(run.body));

  const id = lauf.pendingApproval.id;
  const offen = await srv.rufen('GET', `/status/${id}`);
  check('offener Auftrag: Status ohne Ergebnis',
    offen.body.status === 'awaiting_approval' && offen.body.summary === null, JSON.stringify(offen.body));

  const job = store.getJob(id);
  job.status = 'done';
  job.exitCode = 0;
  job.output = 'Vacuuming done, freed 1.4G of archived journals.';
  const fertig = await srv.rufen('GET', `/status/${id}`);
  check('fertiger Auftrag: Status done', fertig.body.status === 'done');
  check('Rückgabewert kommt mit', fertig.body.exitCode === 0);
  check('Zusammenfassung ist die letzte Zeile', /freed 1.4G/.test(fertig.body.summary));
  check('Karte zum Vorlesen', fertig.body.card?.type === 'AdaptiveCard');

  check('unbekannte Kennung: 404', (await srv.rufen('GET', '/status/gibtsnicht')).code === 404);
  await srv.schliessen();
}

// --- Eskalation --------------------------------------------------------------

async function pruefeTicket() {
  console.log('\nEskalation');
  const ohneJira = await starten({ store: fakeStore(), jiraReady: () => false });
  check('ohne Jira: 503', (await ohneJira.rufen('POST', '/ticket',
    { userId: 'a@bfs.de', summary: 'Drucker', description: 'x' })).code === 503);
  await ohneJira.schliessen();

  const store = fakeStore();
  const srv = await starten({ store });
  check('ohne userId: 400', (await srv.rufen('POST', '/ticket', { summary: 'x' })).code === 400);

  const neu = await srv.rufen('POST', '/ticket', {
    userId: 'anna@bfs.de', summary: 'Bildschirm bleibt schwarz', description: 'Seit heute morgen.',
    sessionId: 'teams-1', deviceId: 'NB-FIN-0427'
  });
  check('Vorgang wird angelegt', neu.code === 201 && /^IT-/.test(neu.body.key), JSON.stringify(neu));
  check('Karte verlinkt den Vorgang', neu.body.card.actions?.[0]?.type === 'Action.OpenUrl');
  check('Anlage steht im Audit-Log', store.events.some((e) => e.event === 'bot.ticket.created'));

  const zweimal = await srv.rufen('POST', '/ticket', {
    userId: 'anna@bfs.de', summary: 'Bildschirm bleibt schwarz', description: 'Nochmal.', sessionId: 'teams-1'
  });
  check('zweiter Anlauf liefert denselben Vorgang',
    zweimal.body.reused === true && zweimal.body.key === neu.body.key, JSON.stringify(zweimal));
  check('und legt keinen zweiten an',
    store.events.filter((e) => e.event === 'bot.ticket.created').length === 1);
  await srv.schliessen();
}

(async () => {
  await pruefeToken();
  await pruefeDiagnose();
  await pruefeFreigabe();
  await pruefeStand();
  await pruefeTicket();
  console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
  process.exit(failed ? 1 : 0);
})();
