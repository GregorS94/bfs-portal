const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || '/data';
const AUDIT_FILE = path.join(DATA_DIR, 'audit.jsonl');

fs.mkdirSync(DATA_DIR, { recursive: true });

// Auftrags- und Geräteverwaltung. Bewusst im Speicher: ein Prototyp, der nach
// einem Neustart leer startet, ist ehrlicher als eine halbgare Datenbank.
// Das Audit-Log dagegen liegt auf der Platte und überlebt alles.
const jobs = new Map();
const devices = new Map();
const waiters = new Map(); // deviceId -> [resolve, ...] für das Long-Polling

// --- Audit-Log ---------------------------------------------------------------
//
// Jeder Eintrag traegt den Hash seines Vorgaengers. Wer eine Zeile nachtraeglich
// aendert oder herausloescht, bricht die Kette ab dieser Stelle — das faellt bei
// `verifyAudit()` auf. Das verhindert keine Manipulation, aber es macht sie
// nachweisbar, und genau das ist der Zweck eines Audit-Logs.
//
// Der Hash deckt den Eintrag ohne sein eigenes `hash`-Feld ab, sonst waere er
// von sich selbst abhaengig.

const GENESIS = '0'.repeat(64);
const RETENTION_DAYS = Number(process.env.AUDIT_RETENTION_DAYS || 0);

function hashEntry(entry) {
  const { hash, ...rest } = entry;
  return crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex');
}

/** Hash und laufende Nummer des letzten Eintrags — die Basis fuer den naechsten. */
function auditTail() {
  if (!fs.existsSync(AUDIT_FILE)) return { prev: GENESIS, seq: 0 };
  const lines = fs.readFileSync(AUDIT_FILE, 'utf8').split('\n').filter(Boolean);
  if (!lines.length) return { prev: GENESIS, seq: 0 };
  try {
    const last = JSON.parse(lines[lines.length - 1]);
    return { prev: last.hash || GENESIS, seq: last.seq || lines.length };
  } catch {
    // Eine unlesbare letzte Zeile ist selbst schon ein Befund. Weiterschreiben
    // mit Genesis waere still; stattdessen bleibt der Bruch in der Kette sichtbar.
    return { prev: GENESIS, seq: lines.length };
  }
}

function audit(event, detail) {
  const { prev, seq } = auditTail();
  const entry = { ts: new Date().toISOString(), seq: seq + 1, event, ...detail, prev };
  entry.hash = hashEntry(entry);
  // Synchron und append-only: das Log wird vom Backend geschrieben, nie vom Modell.
  fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n');
}

/**
 * Prueft die Kette von vorne bis hinten.
 * Liefert { ok, entries, problems: [{ line, reason }] }.
 */
function verifyAudit() {
  if (!fs.existsSync(AUDIT_FILE)) return { ok: true, entries: 0, problems: [] };
  const lines = fs.readFileSync(AUDIT_FILE, 'utf8').split('\n').filter(Boolean);
  const problems = [];
  let prev = GENESIS;

  lines.forEach((raw, i) => {
    const line = i + 1;
    let entry;
    try {
      entry = JSON.parse(raw);
    } catch {
      problems.push({ line, reason: 'Zeile ist kein gültiges JSON.' });
      return;
    }
    // Eintraege von vor der Umstellung haben keine Kette. Sie zu bemaengeln
    // waere Rauschen — ab hier faengt die Kette an.
    if (!entry.hash) {
      prev = GENESIS;
      return;
    }
    if (entry.prev !== prev) {
      problems.push({ line, reason: `Vorgänger-Hash passt nicht (${entry.event}).` });
    }
    if (hashEntry(entry) !== entry.hash) {
      problems.push({ line, reason: `Eintrag wurde nachträglich verändert (${entry.event}).` });
    }

    // Ein Bereinigungs-Marker bezeugt die Luecke, die er selbst gerissen hat:
    // die Kette laeuft beim Hash des letzten geloeschten Eintrags weiter, damit
    // der erste behaltene Eintrag wieder passt. Ohne diesen Sprung saehe jede
    // regulaere Aufbewahrungsfrist wie Manipulation aus.
    prev = entry.event === 'audit.pruned' && entry.lastRemovedHash
      ? entry.lastRemovedHash
      : entry.hash;
  });

  return { ok: problems.length === 0, entries: lines.length, problems };
}

/**
 * Entfernt Eintraege, die aelter als die Aufbewahrungsfrist sind.
 *
 * Das bricht die Kette zwangslaeufig. Damit die Luecke nicht wie Manipulation
 * aussieht, wird der Vorgang selbst als erster Eintrag der neuen Datei
 * protokolliert — mit Anzahl und dem Hash des letzten geloeschten Eintrags.
 */
function pruneAudit(days = RETENTION_DAYS) {
  if (!days || !fs.existsSync(AUDIT_FILE)) return { removed: 0 };

  const cutoff = Date.now() - days * 86_400_000;
  const lines = fs.readFileSync(AUDIT_FILE, 'utf8').split('\n').filter(Boolean);
  const keep = [];
  let lastRemoved = null;

  for (const raw of lines) {
    let entry;
    try {
      entry = JSON.parse(raw);
    } catch {
      keep.push(raw);
      continue;
    }
    if (!keep.length && new Date(entry.ts).getTime() < cutoff) {
      lastRemoved = entry;
    } else {
      keep.push(raw);
    }
  }

  if (!lastRemoved) return { removed: 0 };

  const removed = lines.length - keep.length;
  const marker = {
    ts: new Date().toISOString(),
    seq: 1,
    event: 'audit.pruned',
    removed,
    retentionDays: days,
    lastRemovedHash: lastRemoved.hash || null,
    lastRemovedTs: lastRemoved.ts,
    prev: GENESIS
  };
  marker.hash = hashEntry(marker);

  // Die verbleibenden Eintraege behalten ihre alten Hashes — sie neu zu
  // verketten hiesse, sie neu zu signieren, und der Schutz waere dahin.
  // `verifyAudit()` springt am Marker auf `lastRemovedHash` und liest die
  // Kette dort weiter.
  fs.writeFileSync(AUDIT_FILE, [JSON.stringify(marker), ...keep].join('\n') + '\n');
  return { removed };
}

function readAudit(limit = 200) {
  if (!fs.existsSync(AUDIT_FILE)) return [];
  return fs
    .readFileSync(AUDIT_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .slice(-limit)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .reverse();
}

function registerDevice({ deviceId, hostname, platform, osVersion }) {
  // Agent-gemeldete Geräte sind immer lokal.
  const existing = devices.get(deviceId);
  devices.set(deviceId, {
    deviceId,
    hostname,
    platform,
    osVersion,
    firstSeen: existing?.firstSeen || new Date().toISOString(),
    lastSeen: new Date().toISOString()
  });
  if (!existing) audit('device.registered', { deviceId, hostname, platform });
  return devices.get(deviceId);
}

function touchDevice(deviceId) {
  const d = devices.get(deviceId);
  if (d) d.lastSeen = new Date().toISOString();
}

function listDevices() {
  const now = Date.now();
  return [...devices.values()].map((d) => ({
    ...d,
    driver: 'local',
    // Der Agent meldet sich alle paar Sekunden; 60 s ohne Lebenszeichen = offline.
    online: now - new Date(d.lastSeen).getTime() < 60_000
  }));
}

function createJob({ deviceId, action, params, risk, requestedBy, reason, driver = 'local' }) {
  const job = {
    id: crypto.randomUUID(),
    deviceId,
    driver,
    action,
    params: params || {},
    risk,
    reason: reason || null,
    requestedBy: requestedBy || 'chat',
    status: risk === 'write' ? 'awaiting_approval' : 'queued',
    createdAt: new Date().toISOString(),
    output: null,
    exitCode: null
  };
  jobs.set(job.id, job);
  audit('job.created', { jobId: job.id, deviceId, driver, action, params: job.params, risk, status: job.status });
  // Nur lokale Aufträge gehen in die Agent-Warteschlange. Fremde Treiber
  // (bConnect) werden vom Aufrufer ausgeführt.
  if (job.status === 'queued' && driver === 'local') dispatch(job);
  return job;
}

// Weckt einen wartenden Agenten, sobald ein Auftrag freigegeben ist.
function dispatch(job) {
  const queue = waiters.get(job.deviceId);
  if (queue && queue.length) {
    const resolve = queue.shift();
    job.status = 'dispatched';
    resolve(job);
  }
}

function approveJob(id, approvedBy) {
  const job = jobs.get(id);
  if (!job) return null;
  if (job.status !== 'awaiting_approval') return job;
  job.status = 'queued';
  job.approvedBy = approvedBy;
  job.approvedAt = new Date().toISOString();
  audit('job.approved', { jobId: id, action: job.action, params: job.params, approvedBy, driver: job.driver });
  if (job.driver === 'local') dispatch(job);
  return job;
}

function denyJob(id, deniedBy) {
  const job = jobs.get(id);
  if (!job) return null;
  if (job.status !== 'awaiting_approval') return job;
  job.status = 'denied';
  job.deniedBy = deniedBy;
  audit('job.denied', { jobId: id, action: job.action, params: job.params, deniedBy });
  return job;
}

// Long-Poll: der Agent fragt an und wartet, bis ein Auftrag da ist oder die Zeit abläuft.
function waitForJob(deviceId, timeoutMs = 25_000) {
  const ready = [...jobs.values()].find((j) => j.deviceId === deviceId && j.status === 'queued');
  if (ready) {
    ready.status = 'dispatched';
    return Promise.resolve(ready);
  }

  return new Promise((resolve) => {
    if (!waiters.has(deviceId)) waiters.set(deviceId, []);
    const queue = waiters.get(deviceId);
    queue.push(resolve);

    setTimeout(() => {
      const i = queue.indexOf(resolve);
      if (i !== -1) {
        queue.splice(i, 1);
        resolve(null);
      }
    }, timeoutMs);
  });
}

function completeJob(id, { output, exitCode, error }) {
  const job = jobs.get(id);
  if (!job) return null;
  job.status = error ? 'error' : 'done';
  job.output = output ?? null;
  job.exitCode = exitCode ?? null;
  job.error = error || null;
  job.finishedAt = new Date().toISOString();
  audit('job.finished', {
    jobId: id,
    action: job.action,
    status: job.status,
    exitCode: job.exitCode,
    outputBytes: (job.output || '').length
  });
  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

function listJobs(limit = 50) {
  return [...jobs.values()].slice(-limit).reverse();
}

// Wartet, bis ein Auftrag fertig ist — für lesende Aktionen, bei denen der
// Chat direkt auf das Ergebnis wartet.
function waitForResult(id, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const job = jobs.get(id);
      if (!job) return resolve(null);
      if (['done', 'error', 'denied'].includes(job.status)) return resolve(job);
      if (Date.now() - started > timeoutMs) {
        job.status = 'error';
        job.error = 'Zeitüberschreitung: Der Agent hat nicht geantwortet.';
        audit('job.timeout', { jobId: id, action: job.action });
        return resolve(job);
      }
      setTimeout(tick, 250);
    };
    tick();
  });
}

module.exports = {
  audit, readAudit, verifyAudit, pruneAudit, registerDevice, touchDevice, listDevices,
  createJob, approveJob, denyJob, waitForJob, completeJob,
  getJob, listJobs, waitForResult
};
