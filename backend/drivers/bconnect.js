// Treiber für baramundi bConnect. Spricht wahlweise die alte oder die neue
// Fassung der Schnittstelle; `BCONNECT_VERSION` entscheidet. Vorgabe ist v2.0
// — BFS fährt bMC 26.1, und v2 erlaubt die Anmeldung per Schlüssel statt per
// Dienstkonto. v1 bleibt für ältere Installationen erreichbar.
//
// Beide Formen sind aus den Herstellermodulen übernommen, nicht geraten.
//
// v1.0 — github.com/baramundisoftware/PS-bConnect
//   Basis-URI      https://{server}:{port}/bConnect/v1.0/{Controller}
//   Auth           HTTP Basic
//   Controller     Endpoints | Jobs | JobInstances | EndpointInvSoftware
//   Instanz neu    GET JobInstances?EndpointId=..&JobId=..&StartIfExists=..
//   Instanz start  GET JobInstances?Id=..&Cmd=start
//   Instanz Status GET JobInstances?Id=..
//   Ja, das Anlegen läuft per GET — so macht es das Herstellermodul.
//   Feldnamen in Großschreibung: Id, HostName, State.
//
// v2.0 — powershellgallery.com/packages/bConnectV2(26.1.101)
//   Basis-URI      https://{server}:{port}/bconnect/{bereich}/v2.0{pfad}
//                  Bereich = jobs | endpoints | software | activedirectory
//   Auth           X-API-KEY, ersatzweise HTTP Basic (Add-SecurityHeader.ps1)
//   Geräte         GET  /v2.0/Endpoints
//   Jobs           GET  /v2.0/JobDefinitions
//   Instanz neu    POST /v2.0/JobInstances
//                  { jobDefinitionId, endpointId, startIfAlreadyAssigned }
//   Instanz start  POST /v2.0/JobInstances/{id}/Start
//   Instanz Status GET  /v2.0/JobInstances/{id}
//   Software       GET  /v2.0/WindowsEndpoints/{endpointId}/InstalledWindowsSoftware
//                  (Bereich software; Feldnamen der Rückgabe sind im
//                   Herstellermodul nicht modelliert, siehe execute())
//   Listen antworten mit { data: [...] } (Select-bCPageData.ps1).
//   Feldnamen in Kleinschreibung: id, displayName, state.
//
// ACHTUNG: gegen einen echten bMS-Server ungetestet — beide Fassungen.
// Verifiziert ist der Treiber nur gegen einen Nachbau (tools/bconnect-mock.js),
// der diese Request-Formen spricht.

const https = require('https');
const { URL } = require('url');

const CONFIG = {
  server: process.env.BCONNECT_SERVER || '',
  port: process.env.BCONNECT_PORT || '443',
  version: process.env.BCONNECT_VERSION || 'v2.0',
  user: process.env.BCONNECT_USER || '',
  password: process.env.BCONNECT_PASSWORD || '',
  // Nur v2 kennt Schlüssel. Er ist dem Dienstkonto vorzuziehen: ein Schlüssel
  // lässt sich zurückziehen, ohne dass jemand ein Kennwort ändern muss.
  apiKey: process.env.BCONNECT_API_KEY || '',
  allowSelfSigned: process.env.BCONNECT_ALLOW_SELF_SIGNED === 'true',
  // Abstand zwischen zwei Statusabfragen einer laufenden JobInstance.
  pollMs: Number(process.env.BCONNECT_POLL_MS || 5000),
  // Ohne diese Liste ist NICHTS ausführbar. Der bMS-Katalog enthält auch
  // Rollouts und Compliance-Läufe — die gehören nicht in die Hand des Chats.
  allowedJobs: (process.env.BCONNECT_ALLOWED_JOBS || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
};

const istV2 = () => CONFIG.version.trim().toLowerCase().startsWith('v2');

// v1 kennt nur Basic. v2 nimmt beides, bevorzugt aber den Schlüssel.
const isConfigured = () =>
  Boolean(CONFIG.server && ((istV2() && CONFIG.apiKey) || (CONFIG.user && CONFIG.password)));

// Gemeinsamer Unterbau beider Fassungen: Kopfzeilen setzen, Antwort als JSON
// lesen, Fehler mit Kontext werfen.
function anfrage(bezeichnung, url, { methode = 'GET', koerper = null } = {}) {
  const headers = { Accept: 'application/json' };
  if (istV2() && CONFIG.apiKey) {
    headers['X-API-KEY'] = CONFIG.apiKey;
  } else {
    headers.Authorization =
      'Basic ' + Buffer.from(`${CONFIG.user}:${CONFIG.password}`).toString('base64');
  }

  let daten = null;
  if (koerper !== null) {
    daten = Buffer.from(JSON.stringify(koerper));
    // Der Zeichensatz gehoert ausdruecklich dazu: baramundi verlangt ihn in der
    // bConnect-Dokumentation, sonst kommen Sonderzeichen falsch an. In einer
    // deutschen Umgebung betrifft das jeden zweiten Job- und Geraetenamen.
    headers['Content-Type'] = 'application/json; charset=utf-8';
    // Buffer.from kodiert nach UTF-8, .length ist also die Byte-Zahl. Nicht
    // durch die Zeichenzahl des Strings ersetzen — bei Umlauten waere der
    // Koerper dann zu kurz angekuendigt.
    headers['Content-Length'] = String(daten.length);
  }

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method: methode, headers, rejectUnauthorized: !CONFIG.allowSelfSigned, timeout: 30_000 },
      (res) => {
        // Ohne das wird jeder Abschnitt einzeln nach UTF-8 gewandelt. Faellt ein
        // Umlaut auf eine Abschnittsgrenze, zerreisst seine Byte-Folge und wird
        // zu Ersatzzeichen. setEncoding haelt die Reste zusammen.
        res.setEncoding('utf8');
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode >= 400) {
            return reject(new Error(`bConnect ${bezeichnung}: HTTP ${res.statusCode} — ${body.slice(0, 300)}`));
          }
          try {
            resolve(body ? JSON.parse(body) : null);
          } catch {
            reject(new Error(`bConnect ${bezeichnung}: Antwort ist kein JSON — ${body.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('bConnect: Zeitüberschreitung')));
    req.on('error', reject);
    if (daten) req.write(daten);
    req.end();
  });
}

/** v1: ein Controller, alles als Abfrageparameter, immer GET. */
function get(controller, params = {}) {
  const url = new URL(`https://${CONFIG.server}:${CONFIG.port}/bConnect/${CONFIG.version}/${controller}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  return anfrage(controller, url);
}

/** v2: Bereich im Pfad, echte Verben, Listen kommen in `data`. */
function v2(bereich, pfad, { methode = 'GET', koerper = null } = {}) {
  const url = new URL(`https://${CONFIG.server}:${CONFIG.port}/bconnect/${bereich}/v2.0${pfad}`);
  return anfrage(`${bereich}${pfad}`, url, { methode, koerper });
}

const asArray = (x) => (Array.isArray(x) ? x : x ? [x] : []);

// v2 verpackt Listen in ein Seitenobjekt, v1 liefert das Feld nackt.
const listeAus = (antwort) => asArray(antwort?.data ?? antwort);

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

// Ab hier stehen die Feldnamen beider Fassungen nebeneinander: v1 schreibt sie
// groß, v2 klein. Beide Schreibweisen abzufragen ist billiger, als den Treiber
// zu spalten.
async function listDevices() {
  if (!isConfigured()) return [];
  const endpoints = listeAus(istV2() ? await v2('endpoints', '/Endpoints') : await get('Endpoints'));
  return endpoints.map((e) => ({
    deviceId: e.Id || e.Guid || e.id,
    hostname: e.HostName || e.Name || e.PrimaryName || e.displayName || '(ohne Namen)',
    platform: 'windows',
    osVersion: e.OS || e.OperatingSystem || e.operatingSystem || '',
    lastSeen: e.LastContact || e.lastContact || new Date().toISOString(),
    online: true,
    driver: 'bconnect'
  }));
}

async function listJobs() {
  if (!isConfigured()) return [];
  // In v2 heißt der Katalog "JobDefinitions"; eine JobInstance ist erst die
  // Ausführung davon.
  const jobs = listeAus(istV2() ? await v2('jobs', '/JobDefinitions') : await get('Jobs'));
  return jobs
    .map((j) => ({ id: j.Id || j.Guid || j.id, name: j.Name || j.displayName, comment: j.Comment || j.comment || '' }))
    .filter((j) => CONFIG.allowedJobs.includes(j.name));
}

// Werkzeuge für die KI: ein Auflisten und ein Ausführen. Der `enum` sorgt dafür,
// dass das Modell gar keinen anderen Jobnamen erzeugen kann.
async function toolDefinitions() {
  // Das Lesen der Softwareliste hängt nicht an der Job-Freigabeliste: die
  // begrenzt, was ausgeführt werden darf. Wer keine Jobs freigibt, soll
  // trotzdem sehen können, was auf einem Gerät installiert ist.
  // Nur v2 kennt diesen Weg; in v1 müsste man dafür einen Job auslösen.
  const softwareWerkzeug = istV2() && isConfigured()
    ? [{
        name: 'list_installed_software',
        description:
          'Listet die auf dem Gerät installierte Software mit Version. Liest nur, verändert nichts. Nutze das bei Fragen wie "welche Version habe ich" oder "ist das Programm überhaupt installiert".',
        input_schema: { type: 'object', properties: {}, additionalProperties: false }
      }]
    : [];

  const jobs = await listJobs();
  if (!jobs.length) return softwareWerkzeug;

  return [
    ...softwareWerkzeug,
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

const RISK = { list_bms_jobs: 'read', list_installed_software: 'read', run_bms_job: 'write' };

async function execute(deviceId, action, params = {}) {
  if (!isConfigured()) throw new Error('bConnect ist nicht konfiguriert.');

  if (action === 'list_bms_jobs') {
    const jobs = await listJobs();
    return {
      output: jobs.map((j) => `${j.name}${j.comment ? ' — ' + j.comment : ''}`).join('\n') || '(keine freigegebenen Jobs)',
      exitCode: 0
    };
  }

  if (action === 'list_installed_software') {
    if (!istV2()) throw new Error('Installierte Software lässt sich nur über bConnect v2 lesen.');
    const eintraege = listeAus(
      await v2('software', `/WindowsEndpoints/${encodeURIComponent(deviceId)}/InstalledWindowsSoftware`)
    );
    // Die Feldnamen der Rückgabe sind im Herstellermodul nicht modelliert —
    // es ist ein reiner Lesepfad. Deshalb mehrere Kandidaten. Weicht eure
    // Fassung ab, muss nur diese Zeile angepasst werden.
    const zeilen = eintraege.map((e) => {
      const name = e.displayName || e.name || e.productName || '(ohne Namen)';
      const version = e.displayVersion || e.version || e.productVersion || '';
      const hersteller = e.publisher || e.vendor || e.manufacturer || '';
      return [name, version, hersteller && `(${hersteller})`].filter(Boolean).join(' ');
    });
    return {
      output: zeilen.length ? zeilen.join('\n') : '(keine Software inventarisiert)',
      exitCode: 0
    };
  }

  if (action !== 'run_bms_job') throw new Error(`Unbekannte bConnect-Aktion: ${action}`);

  const jobs = await listJobs();
  const job = jobs.find((j) => j.name === params.jobName);
  // Zweite Prüfung gegen die Freigabeliste — das Modell könnte den enum umgehen,
  // wenn die Werkzeugliste zwischenzeitlich veraltet ist.
  if (!job) throw new Error(`Job "${params.jobName}" ist nicht freigegeben.`);

  const created = istV2()
    ? await v2('jobs', '/JobInstances', {
        methode: 'POST',
        koerper: { jobDefinitionId: job.id, endpointId: deviceId, startIfAlreadyAssigned: true }
      })
    : await get('JobInstances', {
        EndpointId: deviceId,
        JobId: job.id,
        StartIfExists: 'True',
        Initiator: 'BFS Self-Service Portal'
      });

  const instanceId = created?.Id || created?.Guid || created?.id || asArray(created)[0]?.Id;
  if (!instanceId) {
    throw new Error(`bConnect lieferte keine Instanz-ID zurück: ${JSON.stringify(created).slice(0, 200)}`);
  }

  // Eine frisch angelegte Instanz wartet; der Startbefehl setzt sie in Gang.
  // Fehler hier sind nicht fatal — in v1 kann `StartIfExists` sie schon
  // gestartet haben, in v2 antwortet der Start auf eine laufende Instanz mit
  // einem Fehler, der nichts kaputt macht.
  try {
    if (istV2()) {
      await v2('jobs', `/JobInstances/${encodeURIComponent(instanceId)}/Start`, { methode: 'POST' });
    } else {
      await get('JobInstances', { Id: instanceId, Cmd: 'start' });
    }
  } catch (err) {
    console.warn('bConnect: expliziter Start fehlgeschlagen:', err.message);
  }

  const deadline = Date.now() + 10 * 60_000;
  let last = null;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, CONFIG.pollMs));
    last = istV2()
      ? await v2('jobs', `/JobInstances/${encodeURIComponent(instanceId)}`)
      : asArray(await get('JobInstances', { Id: instanceId }))[0] || null;
    const state = interpretState(last);
    if (state.done) {
      return {
        output:
          `Job "${job.name}" auf dem Gerät: ${last?.State ?? last?.state ?? state.raw}\n` +
          (last?.ErrorMessage || last?.errorMessage
            ? `Meldung: ${last.ErrorMessage || last.errorMessage}\n`
            : '') +
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
