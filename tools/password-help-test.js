#!/usr/bin/env node
//
// Prüft den Arbeitsvorrat „Passwort-Hilfe": Anlegen, Abschliessen und vor allem,
// dass die Anfragen einen Neustart überleben. Anders als Aufträge dürfen sie
// nicht im Arbeitsspeicher verschwinden — sonst fällt genau die Anfrage weg,
// auf die jemand wartet.

const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bfs-pwhelp-'));
process.env.DATA_DIR = DATA_DIR;
process.env.AUDIT_RETENTION_DAYS = '0';

const storePath = path.join(__dirname, '..', 'backend', 'jobs.js');
let store = require(storePath);

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

console.log('Anfrage anlegen');
const a = store.createPasswordRequest({
  identity: 'a.muster@bfs.de', contact: '-123', note: 'Konto gesperrt', source: 'public', remote: '10.0.0.5'
});
check('bekommt eine Kennung', typeof a.id === 'string' && a.id.length > 10);
check('ist zunächst offen', a.status === 'open');
check('merkt sich den Weg', a.source === 'public');
check('hat noch kein Ticket', a.ticket === null);
check('taucht in der Liste auf', store.listPasswordRequests().some(r => r.id === a.id));

const b = store.createPasswordRequest({ identity: 'b.beispiel@bfs.de', source: 'portal' });
check('zweite Anfrage bekommt eine andere Kennung', b.id !== a.id);
check('optionale Felder werden zu leeren Zeichenketten', b.contact === '' && b.note === '');

console.log('\nTicket nachtragen');
store.attachTicket(a.id, { key: 'SUP-1', url: 'https://example.invalid/SUP-1' });
check('Ticket hängt an der Anfrage',
  store.listPasswordRequests().find(r => r.id === a.id)?.ticket?.key === 'SUP-1');
check('unbekannte Kennung wird ignoriert', store.attachTicket('gibtsnicht', { key: 'X' }) === null);

console.log('\nAbschliessen');
const closed = store.closePasswordRequest(a.id, 'ben@bfs.de');
check('Status wechselt auf erledigt', closed.status === 'closed');
check('wer es war, steht dabei', closed.closedBy === 'ben@bfs.de');
check('Zeitpunkt ist gesetzt', typeof closed.closedAt === 'string');
check('unbekannte Kennung wird ignoriert', store.closePasswordRequest('gibtsnicht', 'ben@bfs.de') === null);
check('die andere Anfrage bleibt offen',
  store.listPasswordRequests().find(r => r.id === b.id)?.status === 'open');

console.log('\nNeustart');
delete require.cache[require.resolve(storePath)];
store = require(storePath);
const nachNeustart = store.listPasswordRequests();
check('beide Anfragen sind noch da', nachNeustart.length === 2);
check('erledigt bleibt erledigt',
  nachNeustart.find(r => r.id === a.id)?.status === 'closed');
check('offen bleibt offen',
  nachNeustart.find(r => r.id === b.id)?.status === 'open');
check('Ticket überlebt', nachNeustart.find(r => r.id === a.id)?.ticket?.key === 'SUP-1');

console.log('\nBeschädigte Datei');
fs.appendFileSync(path.join(DATA_DIR, 'password-requests.jsonl'), 'das ist kein json\n');
delete require.cache[require.resolve(storePath)];
let startetTrotzdem = true;
try {
  store = require(storePath);
} catch {
  startetTrotzdem = false;
}
check('kaputte Zeile verhindert den Start nicht', startetTrotzdem);
check('die heilen Anfragen sind weiterhin da', store.listPasswordRequests().length === 2);

fs.rmSync(DATA_DIR, { recursive: true, force: true });
console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
