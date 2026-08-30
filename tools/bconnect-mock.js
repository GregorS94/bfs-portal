// Nachbau der bConnect-Endpunkte, die der Treiber benutzt — nur zum Testen.
// Spricht exakt die Request-Formen aus PS-bConnect nach.
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

const ENDPOINTS = [
  { Id: 'ep-0001', HostName: 'PC-MUELLER', OS: 'Windows 11 24H2', LastContact: '2026-08-28T06:00:00Z' },
  { Id: 'ep-0002', HostName: 'PC-SCHMIDT', OS: 'Windows 11 24H2', LastContact: '2026-08-28T06:10:00Z' }
];

const JOBS = [
  { Id: 'job-gpupdate', Name: 'gpupdate', Comment: 'Gruppenrichtlinien aktualisieren' },
  { Id: 'job-chrome', Name: 'Chrome Cache leeren', Comment: 'Browser-Cache des Nutzers loeschen' },
  { Id: 'job-rollout', Name: 'Windows Feature Update', Comment: 'GEFAEHRLICH - darf der Chat nicht' }
];

const instances = new Map();
let counter = 0;

const server = https.createServer(
  { key: fs.readFileSync(`${DIR}/key.pem`), cert: fs.readFileSync(`${DIR}/cert.pem`) },
  (req, res) => {
    const auth = (req.headers.authorization || '').replace('Basic ', '');
    if (Buffer.from(auth, 'base64').toString() !== `${USER}:${PASS}`) {
      res.writeHead(401).end('unauthorized');
      return;
    }

    const url = new URL(req.url, 'https://x');
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

server.listen(8443, '127.0.0.1', () => console.log('bConnect-Mock auf https://127.0.0.1:8443'));
