#!/usr/bin/env node
//
// Prüft die Hash-Kette des Audit-Logs: schreibt, manipuliert, erwartet den Befund.
//
// Läuft gegen ein eigenes DATA_DIR im Temp-Verzeichnis — niemals gegen das
// echte Log, sonst hinge das Ergebnis an gespeicherten Zuständen.

const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-test-'));
process.env.DATA_DIR = DATA_DIR;

const store = require(path.join(__dirname, '..', 'backend', 'jobs.js'));
const AUDIT = path.join(DATA_DIR, 'audit.jsonl');

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

function lines() {
  return fs.readFileSync(AUDIT, 'utf8').split('\n').filter(Boolean);
}

console.log('Audit-Kette');

store.audit('test.eins', { a: 1 });
store.audit('test.zwei', { a: 2 });
store.audit('test.drei', { a: 3 });

const written = lines().map((l) => JSON.parse(l));
check('drei Einträge geschrieben', written.length === 3);
check('laufende Nummern aufsteigend', written.map((e) => e.seq).join(',') === '1,2,3');
check('erster Eintrag zeigt auf Genesis', written[0].prev === '0'.repeat(64));
check('zweiter verkettet mit erstem', written[1].prev === written[0].hash);
check('dritter verkettet mit zweitem', written[2].prev === written[1].hash);
check('unveränderte Kette gilt als heil', store.verifyAudit().ok);

// Ein Eintrag wird nachträglich verfälscht — genau der Fall, gegen den die
// Kette schützt.
const tampered = [...written];
tampered[1] = { ...tampered[1], a: 99 };
fs.writeFileSync(AUDIT, tampered.map((e) => JSON.stringify(e)).join('\n') + '\n');

let result = store.verifyAudit();
check('verfälschter Eintrag wird erkannt', !result.ok);
check(
  'Befund zeigt auf die richtige Zeile',
  result.problems.some((p) => p.line === 2 && /verändert/.test(p.reason)),
  JSON.stringify(result.problems)
);
check('genau ein Befund, wenn der Hash nicht mitgezogen wurde', result.problems.length === 1);

// Der aufwendigere Angriff: Eintrag ändern UND seinen Hash neu berechnen.
// Dann stimmt der Eintrag mit sich selbst überein — aber der Nachfolger zeigt
// noch auf den alten Hash, und genau dort bricht es.
const crypto0 = require('crypto');
const forged = [...written];
const { hash: _drop, ...body } = { ...forged[1], a: 99 };
forged[1] = { ...body, hash: crypto0.createHash('sha256').update(JSON.stringify(body)).digest('hex') };
fs.writeFileSync(AUDIT, forged.map((e) => JSON.stringify(e)).join('\n') + '\n');

result = store.verifyAudit();
check('nachgerechneter Hash rettet den Fälscher nicht', !result.ok);
check(
  'der Bruch zeigt sich beim Nachfolger',
  result.problems.some((p) => p.line === 3 && /Vorgänger/.test(p.reason)),
  JSON.stringify(result.problems)
);

// Eine Zeile spurlos entfernen.
fs.writeFileSync(AUDIT, [written[0], written[2]].map((e) => JSON.stringify(e)).join('\n') + '\n');
result = store.verifyAudit();
check('entfernte Zeile wird erkannt', !result.ok);

// Aufbewahrung: alte Einträge raus, Vorgang selbst protokolliert.
fs.writeFileSync(AUDIT, '');
const alt = { ts: new Date(Date.now() - 40 * 86400000).toISOString(), seq: 1, event: 'alt', prev: '0'.repeat(64) };
const crypto = require('crypto');
alt.hash = crypto.createHash('sha256').update(JSON.stringify({ ts: alt.ts, seq: 1, event: 'alt', prev: alt.prev })).digest('hex');
fs.appendFileSync(AUDIT, JSON.stringify(alt) + '\n');
store.audit('neu', {});

const pruned = store.pruneAudit(30);
check('ein alter Eintrag entfernt', pruned.removed === 1, JSON.stringify(pruned));

const after = lines().map((l) => JSON.parse(l));
check('Löschung ist selbst protokolliert', after[0].event === 'audit.pruned');
check('Marker nennt den letzten gelöschten Hash', after[0].lastRemovedHash === alt.hash);
check('neuer Eintrag ist erhalten', after.some((e) => e.event === 'neu'));
check('Kette nach dem Bereinigen wieder heil', store.verifyAudit().ok, JSON.stringify(store.verifyAudit().problems));

// Ohne Frist wird nichts gelöscht — sonst überrascht ein Standardwert.
check('ohne Frist passiert nichts', store.pruneAudit(0).removed === 0);

fs.rmSync(DATA_DIR, { recursive: true, force: true });

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
