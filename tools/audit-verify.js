#!/usr/bin/env node
//
// Prüft die Hash-Kette des Audit-Logs und meldet jede Zeile, die nicht passt.
// Exit 0 = unversehrt, Exit 1 = Kette gebrochen.
//
//   DATA_DIR=/pfad/zu/data node tools/audit-verify.js
//
// Im Container:
//   docker exec bfs-portal-backend node /app/../tools/audit-verify.js
// — oder einfacher gegen eine Kopie des Volumes auf dem Host.

const path = require('path');

process.env.DATA_DIR = process.env.DATA_DIR || '/data';
const store = require(path.join(__dirname, '..', 'backend', 'jobs.js'));

const result = store.verifyAudit();

console.log(`Audit-Log: ${result.entries} Einträge in ${process.env.DATA_DIR}`);

if (result.ok) {
  console.log('Kette unversehrt.');
  process.exit(0);
}

console.error(`\n${result.problems.length} Problem(e):`);
for (const p of result.problems) {
  console.error(`  Zeile ${p.line}: ${p.reason}`);
}
console.error('\nEine gebrochene Kette heißt: der Eintrag wurde nach dem Schreiben');
console.error('verändert oder es wurde eine Zeile entfernt.');
process.exit(1);
