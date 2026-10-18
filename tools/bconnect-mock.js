// Nachbau der bConnect-Endpunkte, die der Treiber benutzt — nur zum Testen.
// Spricht beide Fassungen: v1 nach PS-bConnect, v2 nach dem Modul bConnectV2
// (Pfade /bconnect/{bereich}/v2.0/…, Listen in `data`, Felder kleingeschrieben,
// Anmeldung wahlweise per X-API-KEY).
const https = require('https');
const { execFileSync } = require('child_process');
const fs = require('fs');
const { URL } = require('url');

const DIR = process.env.MOCK_DIR || '/tmp/bconnect-mock';
fs.mkdirSync(DIR, { recursive: true });
if (!fs.existsSync(`${DIR}/key.pem`)) {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
    '-keyout', `${DIR}/key.pem`, '-out', `${DIR}/cert.pem`, '-subj', '/CN=bms.test']);
}

const USER = 'portal';
const PASS = 'geheim';
const APIKEY = 'schluessel-fuer-den-test';

const ENDPOINTS = [
  { Id: 'ep-0001', HostName: 'PC-MUELLER', OS: 'Windows 11 24H2', LastContact: '2026-08-28T06:00:00Z' },
  { Id: 'ep-0002', HostName: 'PC-SCHMIDT', OS: 'Windows 11 24H2', LastContact: '2026-08-28T06:10:00Z' }
];

const SOFTWARE = {
  'ep-0001': [
    { displayName: 'Google Chrome', displayVersion: '141.0.7390.55', publisher: 'Google LLC' },
    { displayName: '7-Zip', displayVersion: '24.09', publisher: 'Igor Pavlov' }
  ],
  'ep-0002': []
};

const JOBS = [
  { Id: 'job-gpupdate', Name: 'gpupdate', Comment: 'Gruppenrichtlinien aktualisieren' },
  { Id: 'job-chrome', Name: 'Chrome Cache leeren', Comment: 'Browser-Cache des Nutzers loeschen' },
  { Id: 'job-rollout', Name: 'Windows Feature Update', Comment: 'GEFAEHRLICH - darf der Chat nicht' }
];

// AD-Benutzer und -Objekte der Attrappe. Die Feldnamen sind im
// Herstellermodul NICHT modelliert (nur Rumpfe zum Anlegen sind es), also
// steht hier eine plausible Form: `samAccountName` als Anmeldename, `id` als
// Kennung. Genau deshalb liest der Treiber mehrere Kandidaten und gibt die
// uebrigen Schluessel als `felder` mit — was die echte bMS liefert, misst
// tools/bconnect-entdecken.js.
const ADUSERS = [
  { id: 'ad-0001', samAccountName: 'anna.mueller', displayName: 'Anna Müller', mail: 'anna.mueller@bfs.test' },
  { id: 'ad-0002', samAccountName: 'bernd.schmidt', displayName: 'Bernd Schmidt', mail: 'bernd.schmidt@bfs.test' }
];

const ADOBJECTS = [
  { id: 'ado-0001', name: 'PC-MUELLER', distinguishedName: 'CN=PC-MUELLER,OU=Clients,DC=bfs,DC=test' }
];

const instances = new Map();
// Kiosk-Freigaben der Attrappe. Schluessel ist die Kennung, die POST zurueckgibt.
const kioskReleases = new Map();
let counter = 0;

const server = https.createServer(
  { key: fs.readFileSync(`${DIR}/key.pem`), cert: fs.readFileSync(`${DIR}/cert.pem`) },
  (req, res) => {
    const auth = (req.headers.authorization || '').replace('Basic ', '');
    const basicOk = Buffer.from(auth, 'base64').toString() === `${USER}:${PASS}`;
    const keyOk = req.headers['x-api-key'] === APIKEY;
    if (!basicOk && !keyOk) {
      res.writeHead(401).end('unauthorized');
      return;
    }

    const url = new URL(req.url, 'https://x');

    // --- v2 -------------------------------------------------------------
    // Eigener Zweig, weil v2 echte Verben und Pfadsegmente benutzt statt
    // alles in Abfrageparameter zu packen.
    if (url.pathname.includes('/v2.0/')) return v2(req, res, url);

    const controller = url.pathname.split('/').pop();
    const q = Object.fromEntries(url.searchParams);
    const json = (obj) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(obj));

    if (controller === 'Endpoints') return json(ENDPOINTS);
    if (controller === 'Jobs') return json(JOBS);

    if (controller === 'JobInstances') {
      if (q.Id && q.Cmd === 'start') {
        const inst = instances.get(q.Id);
        if (!inst) return res.writeHead(404).end('unknown instance');
        inst.State = 'Running';
        return json(inst);
      }
      if (q.Id) {
        const inst = instances.get(q.Id);
        if (!inst) return res.writeHead(404).end('unknown instance');
        // Nach zwei Abfragen ist der Job fertig.
        inst.polls = (inst.polls || 0) + 1;
        if (inst.polls >= 2) inst.State = 'Successful';
        return json([inst]);
      }
      if (q.EndpointId && q.JobId) {
        const id = `inst-${++counter}`;
        const inst = { Id: id, EndpointId: q.EndpointId, JobId: q.JobId, State: 'Waiting', Initiator: q.Initiator };
        instances.set(id, inst);
        return json(inst);
      }
    }

    res.writeHead(404).end('not found');
  }
);

/** Seitenobjekt, wie v2 es liefert: `data` plus Blaetterangaben. Die
 *  Parameternamen sind in jeder Liste des Moduls dieselben — Page, PageSize,
 *  OrderBy, SearchQuery — und `totalPages` liest der Blaetterhelfer. */
function seite(eintraege, url) {
  const groesse = Number(url.searchParams.get('PageSize') || 100);
  const nummer = Number(url.searchParams.get('Page') || 0);
  const teil = eintraege.slice(nummer * groesse, nummer * groesse + groesse);
  return {
    data: teil,
    page: nummer,
    pageSize: groesse,
    totalCount: eintraege.length,
    totalPages: Math.max(1, Math.ceil(eintraege.length / groesse))
  };
}

/** Freitextsuche ueber alle Textfelder — `SearchQuery` ist kein Filterausdruck. */
function suchen(eintraege, url) {
  const q = (url.searchParams.get('SearchQuery') || '').toLowerCase();
  if (!q) return eintraege;
  return eintraege.filter((e) =>
    Object.values(e).some((v) => typeof v === 'string' && v.toLowerCase().includes(q)));
}

/** v2-Zweig. Felder klein, Listen in `data`, Instanz anlegen per POST. */
function v2(req, res, url) {
  const json = (obj, code = 200) =>
    res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(obj));
  const teile = url.pathname.split('/v2.0/')[1].split('/').filter(Boolean);
  const [ressource, id, befehl] = teile;

  const klein = (o) => Object.fromEntries(
    Object.entries(o).map(([k, v]) => [k[0].toLowerCase() + k.slice(1), v])
  );

  if (ressource === 'Endpoints' && !id) {
    return json({ data: ENDPOINTS.map((e) => klein({ ...e, displayName: e.HostName })) });
  }
  if (ressource === 'WindowsEndpoints' && befehl === 'InstalledWindowsSoftware') {
    return json({ data: SOFTWARE[id] || [] });
  }
  if (ressource === 'JobDefinitions' && !id) {
    return json(seite(JOBS.map((j) => klein({ ...j, displayName: j.Name })), url));
  }
  if (ressource === 'JobDefinitions' && befehl === 'KioskReleases' && req.method === 'GET') {
    return json(seite([...kioskReleases.values()].filter((f) => f.jobDefinitionId === id), url));
  }

  // --- Active Directory ----------------------------------------------------
  // GET /v2.0/ADUsers und /v2.0/ADObjects, beide mit Freitextsuche
  // `SearchQuery` (Samples des Herstellermoduls).
  if (ressource === 'ADUsers' && req.method === 'GET') {
    return json(seite(suchen(ADUSERS, url), url));
  }
  if (ressource === 'ADObjects' && req.method === 'GET') {
    return json(seite(suchen(ADOBJECTS, url), url));
  }

  // --- Kiosk ---------------------------------------------------------------
  // Nach bConnect_Jobs.json (bMS 26R1): POST mit genau zwei Pflichtfeldern,
  // DELETE je Kennung. Die Attrappe weist einen dritten Feldnamen NICHT ab —
  // sie prueft nur, dass die beiden Pflichtfelder da sind, wie der Server.
  if (ressource === 'KioskReleases') {
    if (!id && req.method === 'POST') {
      return leseKoerper(req, (koerper) => {
        if (!koerper?.assignmentTargetId || !koerper?.jobDefinitionId) {
          return json({ message: 'assignmentTargetId und jobDefinitionId sind Pflicht' }, 400);
        }
        const neu = `rel-${++counter}`;
        kioskReleases.set(neu, {
          id: neu,
          assignmentTargetId: koerper.assignmentTargetId,
          jobDefinitionId: koerper.jobDefinitionId
        });
        return json({ id: neu }, 201);
      });
    }
    if (id && req.method === 'DELETE') {
      if (!kioskReleases.has(id)) return json({ message: 'unknown release' }, 404);
      kioskReleases.delete(id);
      // Der Server antwortet auf DELETE ohne Inhalt.
      return res.writeHead(204).end();
    }
    // Leseendpunkte, belegt im Modul bConnectV2.Jobs (2026-10-18):
    // GET /v2.0/KioskReleases blaetterbar, GET /v2.0/KioskReleases/{id} einzeln.
    if (!id && req.method === 'GET') return json(seite([...kioskReleases.values()], url));
    if (id && req.method === 'GET') {
      const eine = kioskReleases.get(id);
      return eine ? json(eine) : json({ message: 'unknown release' }, 404);
    }
  }

  if (ressource === 'JobInstances') {
    if (!id && req.method === 'POST') {
      return leseKoerper(req, (koerper) => {
        if (!koerper?.jobDefinitionId || !koerper?.endpointId) {
          return json({ message: 'jobDefinitionId und endpointId sind Pflicht' }, 400);
        }
        const neu = `inst-${++counter}`;
        // Die Zustandsnamen stammen aus bConnect_Jobs.json (Schema `State`,
        // bMS 26R1). Vorher standen hier erfundene Namen wie "Waiting" und
        // "Successful" — damit hat die Attrappe die Ratelogik des Treibers
        // bestätigt, statt sie zu prüfen.
        instances.set(neu, {
          Id: neu,
          EndpointId: koerper.endpointId,
          JobId: koerper.jobDefinitionId,
          State: 'Assigned'
        });
        return json({ id: neu, state: 'Assigned' }, 201);
      });
    }
    const inst = instances.get(id);
    if (!inst) return json({ message: 'unknown instance' }, 404);

    if (befehl === 'Start' && req.method === 'POST') {
      inst.State = 'Running';
      return json({ id, state: inst.State });
    }
    if (!befehl && req.method === 'GET') {
      inst.polls = (inst.polls || 0) + 1;
      if (inst.polls >= 2) inst.State = ENDZUSTAND.wert;
      return json({
        id,
        state: inst.State,
        stateDescription: inst.State === 'FinishedWithError' ? 'Schritt 2 fehlgeschlagen.' : '',
        endpointId: inst.EndpointId
      });
    }
  }

  return json({ message: 'not found' }, 404);
}

// Womit ein Lauf in v2 endet. Der Test stellt das um, damit auch der
// Fehlerweg einmal wirklich durchlaeuft.
const ENDZUSTAND = { wert: 'FinishedSuccessfully' };

function leseKoerper(req, weiter) {
  let roh = '';
  req.on('data', (c) => (roh += c));
  req.on('end', () => {
    try {
      weiter(roh ? JSON.parse(roh) : null);
    } catch {
      weiter(null);
    }
  });
}

const PORT = Number(process.argv[2] || 8443);

module.exports = { server, PORT, USER, PASS, APIKEY, ENDPOINTS, JOBS, SOFTWARE, ADUSERS, ADOBJECTS, instances, kioskReleases, ENDZUSTAND };

// Nur starten, wenn direkt aufgerufen — bconnect-test.js bindet die Attrappe
// ein und startet sie selbst.
if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () =>
    console.log(`bConnect-Mock auf https://127.0.0.1:${PORT}`));
}
