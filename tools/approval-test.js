#!/usr/bin/env node
//
// Prüft, wer einen Auftrag freigeben darf — insbesondere das Vier-Augen-Prinzip
// bei Aktionen, die fremde Konten betreffen.

const path = require('path');
const { decisionProblem } = require(path.join(__dirname, '..', 'backend', 'approval.js'));
const { rank } = require(path.join(__dirname, '..', 'backend', 'roles.js'));

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

const anna = { id: 'anna@bfs.de', role: 'user' };
const it = { id: 'ben@bfs.de', role: 'it' };
const admin = { id: 'cara@bfs.de', role: 'admin' };

const job = (action, requestedBy) => ({ action, requestedBy });
const may = (user, j) => decisionProblem(user, j, rank) === null;

console.log('Freigabe gewöhnlicher Aktionen');
check('eigener Auftrag darf freigegeben werden', may(anna, job('restart_service', anna.id)));
check('fremder Auftrag nicht als user', !may(anna, job('restart_service', it.id)));
check('IT darf fremde Aufträge freigeben', may(it, job('restart_service', anna.id)));
check('Admin darf fremde Aufträge freigeben', may(admin, job('restart_service', anna.id)));

console.log('\nVier-Augen bei Kontoaktionen');
for (const action of ['reset_ad_password', 'unlock_ad_account']) {
  // Der Kern der Regel: Wer den Auftrag ausgelöst hat, darf ihn nicht selbst
  // freigeben — auch dann nicht, wenn die Rolle es sonst erlauben würde.
  check(`${action}: Anfragender darf nicht selbst freigeben (it)`, !may(it, job(action, it.id)));
  check(`${action}: Anfragender darf nicht selbst freigeben (admin)`, !may(admin, job(action, admin.id)));
  check(`${action}: andere Person mit Rolle it darf`, may(it, job(action, anna.id)));
  check(`${action}: andere Person mit Rolle admin darf`, may(admin, job(action, it.id)));
  check(`${action}: user darf gar nicht`, !may(anna, job(action, it.id)));
  check(`${action}: user auch nicht beim eigenen Auftrag`, !may(anna, job(action, anna.id)));
}

console.log('\nBegründungen');
const reason = decisionProblem(it, job('reset_ad_password', it.id), rank);
check('Selbstfreigabe nennt das Vier-Augen-Prinzip', /Vier-Augen/.test(reason || ''), reason);
const reason2 = decisionProblem(anna, job('reset_ad_password', it.id), rank);
check('fehlende Rolle wird als solche benannt', /IT-Support/.test(reason2 || ''), reason2);

// Eine unbekannte Aktion darf nicht versehentlich als harmlos durchrutschen,
// aber auch nicht härter behandelt werden als eine gewöhnliche.
console.log('\nUnbekannte Aktion');
check('unbekannte Aktion folgt der Grundregel', may(it, job('gibt_es_nicht', anna.id)));
check('unbekannte Aktion: user nicht bei fremdem Auftrag', !may(anna, job('gibt_es_nicht', it.id)));

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
