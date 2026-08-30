// Treiber für baramundi bConnect.
//
// Request-Formen sind aus dem Herstellermodul PS-bConnect übernommen
// (github.com/baramundisoftware/PS-bConnect), nicht geraten:
//   Basis-URI     https://{server}:{port}/bConnect/{version}/{Controller}
//   Auth          HTTP Basic
//   Controller    Endpoints | Jobs | JobInstances | EndpointInvSoftware
//   Instanz neu   GET JobInstances?EndpointId=..&JobId=..&StartIfExists=..
//   Instanz start GET JobInstances?Id=..&Cmd=start
//   Instanz Status GET JobInstances?Id=..
// Ja, das Anlegen läuft per GET — so macht es das Herstellermodul.
//
// ACHTUNG: gegen einen echten bMS-Server ungetestet. Verifiziert ist der Treiber
// nur gegen einen Nachbau (tools/bconnect-mock.js), der diese Request-Formen spricht.

const https = require('https');
const { URL } = require('url');

const CONFIG = {
  server: process.env.BCONNECT_SERVER || '',
  port: process.env.BCONNECT_PORT || '443',
  version: process.env.BCONNECT_VERSION || 'v1.0',
  user: process.env.BCONNECT_USER || '',
  password: process.env.BCONNECT_PASSWORD || '',
  allowSelfSigned: process.env.BCONNECT_ALLOW_SELF_SIGNED === 'true',
  // Ohne diese Liste ist NICHTS ausführbar. Der bMS-Katalog enthält auch
  // Rollouts und Compliance-Läufe — die gehören nicht in die Hand des Chats.
  allowedJobs: (process.env.BCONNECT_ALLOWED_JOBS || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
};

const isConfigured = () => Boolean(CONFIG.server && CONFIG.user && CONFIG.password);

function get(controller, params = {}) {
  const url = new URL(`https://${CONFIG.server}:${CONFIG.port}/bConnect/${CONFIG.version}/${controller}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const auth = Buffer.from(`${CONFIG.user}:${CONFIG.password}`).toString('base64');

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
        rejectUnauthorized: !CONFIG.allowSelfSigned,
        timeout: 30_000
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode >= 400) {
            return reject(new Error(`bConnect ${controller}: HTTP ${res.statusCode} — ${body.slice(0, 300)}`));
          }
          try {
            resolve(body ? JSON.parse(body) : null);
          } catch {
            reject(new Error(`bConnect ${controller}: Antwort ist kein JSON — ${body.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('bConnect: Zeitüberschreitung')));
    req.on('error', reject);
    req.end();
  });
}

const asArray = (x) => (Array.isArray(x) ? x : x ? [x] : []);

// Einzige Stelle, an der bConnect-Feldnamen interpretiert werden. Weichen sie
// bei eurer Version ab, muss nur hier etwas angepasst werden.
const TERMINAL_OK = ['successful', 'success', 'completed', 'finished', 'ok', 'done'];
const TERMINAL_FAIL = ['error', 'failed', 'aborted', 'cancelled', 'canceled', 'timeout'];

function interpretState(instance) {
  const raw = String(instance?.State ?? instance?.Status ?? instance?.state ?? '').toLowerCase();
  if (TERMINAL_OK.some((s) => raw.includes(s))) return { done: true, ok: true, raw };
  if (TERMINAL_FAIL.some((s) => raw.includes(s))) return { done: true, ok: false, raw };
  return { done: false, ok: false, raw };
}

async function listDevices() {
  if (!isConfigured()) return [];
  const endpoints = asArray(await get('Endpoints'));
  return endpoints.map((e) => ({
    deviceId: e.Id || e.Guid,
    hostname: e.HostName || e.Name || e.PrimaryName || '(ohne Namen)',
    platform: 'windows',
    osVersion: e.OS || e.OperatingSystem || '',
    lastSeen: e.LastContact || new Date().toISOString(),
    online: true,
    driver: 'bconnect'
  }));
}

async function listJobs() {
  if (!isConfigured()) return [];
  const jobs = asArray(await get('Jobs'));
  return jobs
    .map((j) => ({ id: j.Id || j.Guid, name: j.Name, comment: j.Comment || '' }))
    .filter((j) => CONFIG.allowedJobs.includes(j.name));
}

// Werkzeuge für die KI: ein Auflisten und ein Ausführen. Der `enum` sorgt dafür,
// dass das Modell gar keinen anderen Jobnamen erzeugen kann.
async function toolDefinitions() {
  const jobs = await listJobs();
  if (!jobs.length) return [];

  return [
    {
      name: 'list_bms_jobs',
      description:
        'Listet die für den Support freigegebenen baramundi-Jobs mit Beschreibung. Nutze das, wenn unklar ist, welche Aktion passt.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'run_bms_job',
      description:
        'Führt einen freigegebenen baramundi-Job auf dem Gerät aus. Verändert das System und wird erst nach Freigabe durch den Nutzer gestartet. Verfügbar: ' +
        jobs.map((j) => j.name).join(', '),
      input_schema: {
        type: 'object',
        properties: {
          jobName: { type: 'string', enum: jobs.map((j) => j.name), description: 'Name des Jobs aus dem Katalog' }
        },
        required: ['jobName'],
        additionalProperties: false
      }
    }
  ];
}

const RISK = { list_bms_jobs: 'read', run_bms_job: 'write' };

async function execute(deviceId, action, params = {}) {
  if (!isConfigured()) throw new Error('bConnect ist nicht konfiguriert.');

  if (action === 'list_bms_jobs') {
    const jobs = await listJobs();
    return {
      output: jobs.map((j) => `${j.name}${j.comment ? ' — ' + j.comment : ''}`).join('\n') || '(keine freigegebenen Jobs)',
      exitCode: 0
    };
  }

  if (action !== 'run_bms_job') throw new Error(`Unbekannte bConnect-Aktion: ${action}`);

  const jobs = await listJobs();
  const job = jobs.find((j) => j.name === params.jobName);
  // Zweite Prüfung gegen die Freigabeliste — das Modell könnte den enum umgehen,
  // wenn die Werkzeugliste zwischenzeitlich veraltet ist.
  if (!job) throw new Error(`Job "${params.jobName}" ist nicht freigegeben.`);

  const created = await get('JobInstances', {
    EndpointId: deviceId,
    JobId: job.id,
    StartIfExists: 'True',
    Initiator: 'BFS Self-Service Portal'
  });

  const instanceId = created?.Id || created?.Guid || asArray(created)[0]?.Id;
  if (!instanceId) {
    throw new Error(`bConnect lieferte keine Instanz-ID zurück: ${JSON.stringify(created).slice(0, 200)}`);
  }

  // StartIfExists startet eine bestehende Instanz; eine frisch angelegte
  // braucht den expliziten Startbefehl. Fehler hier sind nicht fatal.
  try {
    await get('JobInstances', { Id: instanceId, Cmd: 'start' });
  } catch (err) {
    console.warn('bConnect: expliziter Start fehlgeschlagen:', err.message);
  }

  const deadline = Date.now() + 10 * 60_000;
  let last = null;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5_000));
    last = asArray(await get('JobInstances', { Id: instanceId }))[0] || null;
    const state = interpretState(last);
    if (state.done) {
      return {
        output:
          `Job "${job.name}" auf dem Gerät: ${last?.State ?? state.raw}\n` +
          (last?.ErrorMessage ? `Meldung: ${last.ErrorMessage}\n` : '') +
          `Instanz: ${instanceId}`,
        exitCode: state.ok ? 0 : 1,
        error: state.ok ? null : `Job endete mit Status "${state.raw}".`
      };
    }
  }

  return {
    output: `Job "${job.name}" läuft noch (Instanz ${instanceId}, Status ${interpretState(last).raw || 'unbekannt'}).`,
    exitCode: null,
    error: 'Zeitüberschreitung nach 10 Minuten — der Job läuft im bMS weiter.'
  };
}

module.exports = { name: 'bconnect', isConfigured, listDevices, listJobs, toolDefinitions, execute, RISK, CONFIG };
