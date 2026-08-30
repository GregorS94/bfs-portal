#!/usr/bin/env node
//
// Prüft den einfachen Anmeldeweg: Was als Kennung durchgeht, ob sich eine
// Sitzung fälschen lässt, und ob abgelaufene Sitzungen wirklich abgelaufen sind.

const path = require('path');
const { IDENTITY, signToken, verifyToken, roleFromName } =
  require(path.join(__dirname, '..', 'backend', 'simple-auth.js'));

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

const SECRET = 'geheim-fuer-den-test';
const HOUR = 60 * 60 * 1000;

console.log('Anmeldename');
check('UPN wird angenommen', IDENTITY.test('a.muster@bfs.de'));
check('bloßer Kontoname wird angenommen', IDENTITY.test('a.muster'));
check('leer wird abgelehnt', !IDENTITY.test(''));
check('Leerzeichen wird abgelehnt', !IDENTITY.test('a muster'));
check('Zeilenumbruch wird abgelehnt', !IDENTITY.test('a.muster@bfs.de\nadmin'));
check('spitze Klammern werden abgelehnt', !IDENTITY.test('<script>@bfs.de'));
check('überlanger Name wird abgelehnt', !IDENTITY.test('x'.repeat(65) + '@bfs.de'));

console.log('\nSitzung ausstellen und prüfen');
const token = signToken('a.muster@bfs.de', SECRET, HOUR);
check('eigene Sitzung wird erkannt', verifyToken(token, SECRET)?.id === 'a.muster@bfs.de');
check('anderes Geheimnis wird abgelehnt', verifyToken(token, 'anderes') === null);
check('leeres Token wird abgelehnt', verifyToken('', SECRET) === null);
check('Müll wird abgelehnt', verifyToken('kein.token', SECRET) === null);
check('fehlende Signatur wird abgelehnt', verifyToken(token.split('.')[0], SECRET) === null);

console.log('\nFälschungsversuche');
const [body, sig] = token.split('.');
const fremd = Buffer.from(JSON.stringify({ id: 'chef@bfs.de', exp: Date.now() + HOUR })).toString('base64url');
check('ausgetauschte Kennung mit alter Signatur wird abgelehnt',
  verifyToken(`${fremd}.${sig}`, SECRET) === null);
check('verlängerte Gültigkeit wird abgelehnt', (() => {
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
  claims.exp = Date.now() + 100 * HOUR;
  const gefaelscht = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return verifyToken(`${gefaelscht}.${sig}`, SECRET) === null;
})());
check('Signatur anderer Länge wird abgelehnt statt zu werfen',
  verifyToken(`${body}.kurz`, SECRET) === null);

console.log('\nAblauf');
const abgelaufen = signToken('a.muster@bfs.de', SECRET, -1000);
check('abgelaufene Sitzung wird abgelehnt', verifyToken(abgelaufen, SECRET) === null);
check('Sitzung gilt vor dem Ablauf',
  verifyToken(signToken('a.muster@bfs.de', SECRET, HOUR), SECRET, Date.now() + HOUR / 2) !== null);
check('Sitzung gilt nach dem Ablauf nicht mehr',
  verifyToken(signToken('a.muster@bfs.de', SECRET, HOUR), SECRET, Date.now() + 2 * HOUR) === null);
check('Kennung im Token wird gegen dieselbe Regel geprüft', (() => {
  const boes = Buffer.from(JSON.stringify({ id: 'a b c', exp: Date.now() + HOUR })).toString('base64url');
  const crypto = require('crypto');
  const s = crypto.createHmac('sha256', SECRET).update(boes).digest('base64url');
  return verifyToken(`${boes}.${s}`, SECRET) === null;
})());

console.log('\nRollen aus den Namenslisten');
const admins = ['chef@bfs.de'];
const its = ['ben@bfs.de'];
check('Standard ist die kleinste Rolle', roleFromName('a.muster@bfs.de', admins, its) === 'user');
check('IT-Liste greift', roleFromName('ben@bfs.de', admins, its) === 'it');
check('Admin-Liste greift', roleFromName('chef@bfs.de', admins, its) === 'admin');
check('Groß-/Kleinschreibung egal', roleFromName('BEN@BFS.DE', admins, its) === 'it');
check('leere Listen geben user', roleFromName('ben@bfs.de') === 'user');

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
