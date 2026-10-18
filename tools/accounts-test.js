#!/usr/bin/env node
//
// Prüft die lokalen Konten ohne Datenbank: Passworthashes, Sitzungstoken mit
// Fassungsnummer, die Regeln gegen das Selbst-Aussperren und die Anmeldebremse.
//
// Alles hier ist reine Rechnung. Was SQL tut, prüft tools/db-test.js gegen
// einen echten Postgres.

const path = require('path');
const accounts = require(path.join(__dirname, '..', 'backend', 'accounts.js'));
const { createLockout } = require(path.join(__dirname, '..', 'backend', 'lockout.js'));

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

console.log('Anmeldename');
check('Kontoname wird angenommen', accounts.usernameProblem('admin') === null);
check('UPN wird angenommen', accounts.usernameProblem('a.muster@bfs.de') === null);
check('leer wird abgelehnt', accounts.usernameProblem('') !== null);
check('Leerzeichen wird abgelehnt', accounts.usernameProblem('a muster') !== null);
check('Zeilenumbruch wird abgelehnt', accounts.usernameProblem('admin\nroot') !== null);
check('SQL-Anführungszeichen wird abgelehnt', accounts.usernameProblem("ad'min") !== null);
check('Großschreibung wird vereinheitlicht', accounts.normalizeUsername(' ADMIN ') === 'admin');

console.log('\nPasswort hashen und prüfen');
const hash = accounts.hashPassword('admin');
check('Format ist scrypt mit Parametern', /^scrypt\$16384\$8\$1\$[\w-]+\$[\w-]+$/.test(hash));
check('richtiges Passwort passt', accounts.verifyPassword('admin', hash));
check('falsches Passwort passt nicht', !accounts.verifyPassword('Admin', hash));
check('leeres Passwort passt nicht', !accounts.verifyPassword('', hash));
check('zwei Hashes desselben Passworts sind verschieden', accounts.hashPassword('admin') !== hash);
check('Müll als gespeicherter Wert gilt als falsch', !accounts.verifyPassword('admin', 'kein-hash'));
check('abgeschnittener Hash gilt als falsch', !accounts.verifyPassword('admin', hash.slice(0, -4)));
check('fremdes Verfahren gilt als falsch',
  !accounts.verifyPassword('admin', hash.replace('scrypt', 'md5')));
check('„1234" ist erlaubt (so bestellt)', accounts.passwordProblem('1234') === null);
check('drei Zeichen sind zu kurz', accounts.passwordProblem('abc') !== null);
check('überlanges Passwort wird abgelehnt', accounts.passwordProblem('x'.repeat(201)) !== null);
check('„admin" gilt als Startpasswort', accounts.isDefaultPassword('admin'));
check('„1234" gilt als Startpasswort', accounts.isDefaultPassword('1234'));
check('eigenes Passwort gilt nicht als Startpasswort', !accounts.isDefaultPassword('Tulpe-im-Mai'));

console.log('\nSitzungstoken');
const SECRET = 'geheim-fuer-den-test';
const HOUR = 60 * 60 * 1000;
const token = accounts.signSession({ username: 'admin', tokenVersion: 2 }, SECRET, HOUR);
const claims = accounts.verifySession(token, SECRET);
check('eigene Sitzung wird erkannt', claims?.id === 'admin');
check('Fassungsnummer steht im Token', claims?.v === 2);
check('anderes Geheimnis wird abgelehnt', accounts.verifySession(token, 'anderes') === null);
check('leeres Token wird abgelehnt', accounts.verifySession('', SECRET) === null);
check('Müll wird abgelehnt', accounts.verifySession('kein.token', SECRET) === null);
check('abgelaufene Sitzung wird abgelehnt',
  accounts.verifySession(accounts.signSession({ username: 'admin', tokenVersion: 1 }, SECRET, -1000), SECRET) === null);
check('vertauschte Hälften werden abgelehnt', (() => {
  const [body, sig] = token.split('.');
  return accounts.verifySession(`${sig}.${body}`, SECRET) === null;
})());
check('geänderter Rumpf wird abgelehnt', (() => {
  const [body, sig] = token.split('.');
  const boese = Buffer.from(JSON.stringify({ id: 'admin', v: 99, exp: Date.now() + HOUR })).toString('base64url');
  return accounts.verifySession(`${boese}.${sig}`, SECRET) === null;
})());
check('Rumpf ohne Fassungsnummer wird abgelehnt', (() => {
  const crypto = require('crypto');
  const body = Buffer.from(JSON.stringify({ id: 'admin', exp: Date.now() + HOUR })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return accounts.verifySession(`${body}.${sig}`, SECRET) === null;
})());
check('Kennung im Token wird gegen dasselbe Muster geprüft', (() => {
  const crypto = require('crypto');
  const body = Buffer.from(JSON.stringify({ id: 'admin\nroot', v: 1, exp: Date.now() + HOUR })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return accounts.verifySession(`${body}.${sig}`, SECRET) === null;
})());

console.log('\nWer darf wen ändern');
const chef = { id: 1, username: 'admin', role: 'admin', active: true };
const zweiterChef = { id: 2, username: 'admin2', role: 'admin', active: true };
const mitarbeiter = { id: 3, username: 'user', role: 'user', active: true };

check('fremdes Konto sperren ist erlaubt',
  accounts.changeProblem(chef, mitarbeiter, { active: false }, 1) === null);
check('fremde Rolle ändern ist erlaubt',
  accounts.changeProblem(chef, mitarbeiter, { role: 'it' }, 1) === null);
check('unbekannte Rolle wird abgelehnt',
  accounts.changeProblem(chef, mitarbeiter, { role: 'gott' }, 1) !== null);
check('eigenes Konto löschen ist verboten',
  accounts.changeProblem(chef, chef, { remove: true }, 2) !== null);
check('eigenes Konto sperren ist verboten',
  accounts.changeProblem(chef, chef, { active: false }, 2) !== null);
check('eigene Adminrolle abgeben ist verboten',
  accounts.changeProblem(chef, chef, { role: 'user' }, 2) !== null);
check('letzten Admin löschen ist verboten',
  accounts.changeProblem(zweiterChef, chef, { remove: true }, 1) !== null);
check('letzten Admin sperren ist verboten',
  accounts.changeProblem(zweiterChef, chef, { active: false }, 1) !== null);
check('letzten Admin herabsetzen ist verboten',
  accounts.changeProblem(zweiterChef, chef, { role: 'it' }, 1) !== null);
check('vorletzten Admin löschen ist erlaubt',
  accounts.changeProblem(zweiterChef, chef, { remove: true }, 2) === null);
check('gesperrter Admin zählt nicht als letzter',
  accounts.changeProblem(zweiterChef, { ...chef, active: false }, { remove: true }, 1) === null);
check('unbekanntes Konto wird abgelehnt',
  accounts.changeProblem(chef, null, { remove: true }, 2) !== null);

console.log('\nAnmeldebremse');
const bremse = createLockout({ maxFehler: 3, fensterMs: 1000, sperreMs: 500 });
const KEY = 'admin|127.0.0.1';
check('frischer Schlüssel ist offen', bremse.blocked(KEY, 0) === 0);
check('erster Fehlversuch sperrt nicht', bremse.fail(KEY, 0) === false);
check('zweiter Fehlversuch sperrt nicht', bremse.fail(KEY, 10) === false);
check('dritter Fehlversuch sperrt', bremse.fail(KEY, 20) === true);
check('gesperrt mit Restzeit in Sekunden', bremse.blocked(KEY, 20) === 1);
check('andere Adresse ist nicht mitgesperrt', bremse.blocked('admin|10.0.0.9', 20) === 0);
check('nach der Frist ist wieder offen', bremse.blocked(KEY, 600) === 0);
check('Erfolg löscht die Zählung', (() => {
  bremse.reset(KEY);
  return bremse.fail(KEY, 700) === false;
})());
check('Fehlversuche außerhalb des Fensters zählen neu', (() => {
  const b = createLockout({ maxFehler: 2, fensterMs: 100, sperreMs: 100 });
  b.fail('k', 0);
  // 200 ms später: das Fenster ist zu, die Zählung beginnt von vorn.
  return b.fail('k', 200) === false;
})());

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
