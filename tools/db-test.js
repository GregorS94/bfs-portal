#!/usr/bin/env node
//
// Prüft die Datenbankschicht gegen einen ECHTEN Postgres: Schema, Startkonten,
// Kontenverwaltung und den Kiosk-Ablauf. Das, was accounts-test.js nicht kann —
// dort ist alles reine Rechnung, hier läuft wirklich SQL.
//
// Aufruf (auf dem Host, in dem der Portal-Stapel läuft):
//
//   docker compose cp tools bfs-portal-backend:/tmp/tools
//   docker compose exec -e DATABASE_URL=postgres://portal:PASS@db:5432/bfs_portal \
//     backend node /tmp/tools/db-test.js
//
// Der Test legt eine eigene Datenbank `<name>_test` an und wirft sie am Ende
// weg. Die Daten des Portals bleiben unberührt — das ist der Grund für den
// Umweg, und nicht nur Vorsicht: ein Lauf gegen die echte Tabelle würde die
// Konten des Portals löschen.

const assert = require('assert');
const path = require('path');
const { Client } = require(require.resolve('pg', { paths: ['/app/node_modules', path.join(__dirname, '..', 'backend', 'node_modules')] }));

const ADMIN_URL = process.env.DATABASE_URL
  || `postgres://${process.env.DB_USER || 'portal'}:${process.env.DB_PASSWORD || ''}@${process.env.DB_HOST || 'db'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'bfs_portal'}`;

const TEST_DB = (process.env.DB_NAME || 'bfs_portal') + '_test';
const TEST_URL = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.log(`  FAIL ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}

/** Legt die Testdatenbank neu an. */
async function frischeDatenbank() {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();
}

async function main() {
  await frischeDatenbank();

  // Erst die Umgebung setzen, dann laden: db.js liest die Konfiguration beim
  // Einlesen des Moduls.
  process.env.DATABASE_URL = TEST_URL;
  const wurzel = require('fs').existsSync('/app/db.js') ? '/app' : path.join(__dirname, '..', 'backend');
  const db = require(path.join(wurzel, 'db.js'));
  const users = require(path.join(wurzel, 'users.js'));
  const accounts = require(path.join(wurzel, 'accounts.js'));
  const kiosk = require(path.join(wurzel, 'kiosk.js'));
  const bconnect = require(path.join(wurzel, 'drivers', 'bconnect.js'));

  console.log('Schema und Startkonten');
  await check('init() legt alles an', async () => {
    assert.strictEqual(await db.init(), true);
  });
  await check('init() ein zweites Mal ändert nichts', async () => {
    await db.init();
    assert.strictEqual((await users.list()).length, 2);
  });
  await check('admin ist Administrator', async () => {
    const konto = await users.findForLogin('admin');
    assert.strictEqual(konto.role, 'admin');
  });
  await check('admin hat das Passwort „admin"', async () => {
    const konto = await users.findForLogin('admin');
    assert.ok(accounts.verifyPassword('admin', konto.passwordHash));
  });
  await check('user hat das Passwort „1234" und die Rolle user', async () => {
    const konto = await users.findForLogin('user');
    assert.strictEqual(konto.role, 'user');
    assert.ok(accounts.verifyPassword('1234', konto.passwordHash));
  });
  await check('beide Startkonten sind als „zu ändern" markiert', async () => {
    const liste = await users.list();
    assert.ok(liste.every((u) => u.mustChange));
  });
  await check('falsches Passwort passt nicht', async () => {
    const konto = await users.findForLogin('admin');
    assert.ok(!accounts.verifyPassword('admin1', konto.passwordHash));
  });
  await check('der Hash steht in keiner Sicht für die Oberfläche', async () => {
    const liste = await users.list();
    assert.ok(liste.every((u) => !('passwordHash' in u)));
    assert.ok(!('passwordHash' in (await users.findById(1))));
  });
  await check('unbekanntes Konto gibt null', async () => {
    assert.strictEqual(await users.findForLogin('niemand'), null);
  });
  await check('Groß-/Kleinschreibung beim Anmelden ist egal', async () => {
    assert.ok(await users.findForLogin('ADMIN'));
  });

  console.log('\nKonten anlegen und ändern');
  let neu;
  await check('neues Konto anlegen', async () => {
    neu = await users.create({ username: 'B.Weber', password: 'Dreiklang-7', role: 'it', displayName: 'Ben Weber' });
    assert.strictEqual(neu.username, 'b.weber');
    assert.strictEqual(neu.role, 'it');
  });
  await check('derselbe Name zweimal wird abgelehnt', async () => {
    await assert.rejects(() => users.create({ username: 'b.weber', password: 'Dreiklang-7' }), /gibt es schon/);
  });
  await check('zu kurzes Passwort wird abgelehnt', async () => {
    await assert.rejects(() => users.create({ username: 'kurz', password: 'ab' }), /Zeichen/);
  });
  await check('unerlaubter Name wird abgelehnt', async () => {
    await assert.rejects(() => users.create({ username: 'ben weber', password: 'Dreiklang-7' }), /Zeichen/);
  });
  await check('unbekannte Rolle wird abgelehnt', async () => {
    await assert.rejects(() => users.create({ username: 'chef2', password: 'Dreiklang-7', role: 'gott' }), /Rolle/);
  });
  await check('Rolle ändern', async () => {
    const geaendert = await users.update(neu.id, { role: 'admin' });
    assert.strictEqual(geaendert.role, 'admin');
  });
  await check('zwei aktive Administratoren werden gezählt', async () => {
    assert.strictEqual(await users.countActiveAdmins(), 2);
  });
  await check('Sperren beendet laufende Sitzungen (Token-Fassung steigt)', async () => {
    const vorher = (await users.findForSession('b.weber')).tokenVersion;
    await users.update(neu.id, { active: false });
    const nachher = await users.findForSession('b.weber');
    assert.strictEqual(nachher.tokenVersion, vorher + 1);
    assert.strictEqual(nachher.active, false);
  });
  await check('ein gesperrter Administrator zählt nicht mehr', async () => {
    assert.strictEqual(await users.countActiveAdmins(), 1);
  });
  await check('Passwort setzen beendet laufende Sitzungen', async () => {
    const vorher = (await users.findForSession('b.weber')).tokenVersion;
    const nachher = await users.setPassword(neu.id, 'Neues-Wort-9', { mustChange: true });
    assert.strictEqual((await users.findForSession('b.weber')).tokenVersion, vorher + 1);
    assert.strictEqual(nachher.mustChange, true);
  });
  await check('das neue Passwort gilt, das alte nicht mehr', async () => {
    const konto = await users.findForLogin('b.weber');
    assert.ok(accounts.verifyPassword('Neues-Wort-9', konto.passwordHash));
    assert.ok(!accounts.verifyPassword('Dreiklang-7', konto.passwordHash));
  });
  await check('löschen', async () => {
    assert.strictEqual(await users.remove(neu.id), true);
    assert.strictEqual(await users.findForLogin('b.weber'), null);
  });
  await check('zweimal löschen meldet false', async () => {
    assert.strictEqual(await users.remove(neu.id), false);
  });
  await check('ein gelöschtes Startkonto kommt durch init() nicht zurück', async () => {
    const user = await users.findForLogin('user');
    await users.remove(user.id);
    await db.init();
    assert.strictEqual(await users.findForLogin('user'), null);
  });

  console.log('\nKiosk-Ablauf');
  // Der Treiber wird für diesen Teil ersetzt: geprüft werden soll der Ablauf
  // im Portal, nicht noch einmal die Schnittstelle (das tut kiosk-test.js).
  const gerufen = [];
  bconnect.kioskReady = () => true;
  bconnect.kioskWebUrl = () => 'https://bms.test/bWebServer/Kiosk';
  bconnect.listKioskJobs = async () => [
    { id: 'job-chrome', name: 'Google Chrome', comment: 'Browser' },
    { id: 'job-7zip', name: '7-Zip', comment: 'Archive' }
  ];
  bconnect.createKioskRelease = async (auftrag) => {
    gerufen.push(['create', auftrag]);
    return { id: 'rel-99' };
  };
  bconnect.deleteKioskRelease = async (id) => {
    gerufen.push(['delete', id]);
    return true;
  };

  let anforderung;
  await check('anfordern', async () => {
    anforderung = await kiosk.request({ username: 'a.muster', jobDefinitionId: 'job-chrome', note: 'brauche ich für die Arbeit' });
    assert.strictEqual(anforderung.state, 'requested');
    assert.strictEqual(anforderung.jobName, 'Google Chrome');
  });
  await check('ein Job außerhalb des Katalogs wird abgelehnt', async () => {
    await assert.rejects(() => kiosk.request({ username: 'a.muster', jobDefinitionId: 'job-rollout' }), /Katalog/);
  });
  await check('zweimal dasselbe wird abgelehnt', async () => {
    await assert.rejects(() => kiosk.request({ username: 'a.muster', jobDefinitionId: 'job-chrome' }), /schon/);
  });
  await check('der Katalog zeigt den eigenen Stand', async () => {
    const katalog = await kiosk.catalog('a.muster');
    assert.strictEqual(katalog.jobs.length, 2);
    assert.strictEqual(katalog.requests.length, 1);
    assert.strictEqual(katalog.kioskUrl, 'https://bms.test/bWebServer/Kiosk');
  });
  await check('fremde Anforderungen stehen nicht im eigenen Katalog', async () => {
    const katalog = await kiosk.catalog('c.anders');
    assert.strictEqual(katalog.requests.length, 0);
  });
  await check('die IT sieht die offene Anforderung', async () => {
    const offen = await kiosk.listAll({ onlyOpen: true });
    assert.strictEqual(offen.length, 1);
  });
  await check('freigeben ruft die bMS mit den zwei Pflichtfeldern', async () => {
    const frei = await kiosk.release(anforderung.id, { assignmentTargetId: 'ad-0007', decidedBy: 'ben@bfs.de' });
    assert.strictEqual(frei.state, 'released');
    assert.strictEqual(frei.releaseId, 'rel-99');
    assert.deepStrictEqual(gerufen.at(-1), ['create', { assignmentTargetId: 'ad-0007', jobDefinitionId: 'job-chrome' }]);
  });
  await check('ohne Zuweisungsziel wird nicht freigegeben', async () => {
    const zweite = await kiosk.request({ username: 'c.anders', jobDefinitionId: 'job-7zip' });
    await assert.rejects(() => kiosk.release(zweite.id, { decidedBy: 'ben@bfs.de' }), /Zuweisungsziel/);
    assert.strictEqual((await kiosk.byId(zweite.id)).state, 'requested');
  });
  await check('scheitert die bMS, bleibt die Anforderung offen', async () => {
    const dritte = await kiosk.request({ username: 'd.dritte', jobDefinitionId: 'job-7zip' });
    bconnect.createKioskRelease = async () => { throw new Error('bConnect: HTTP 500'); };
    await assert.rejects(() => kiosk.release(dritte.id, { assignmentTargetId: 'ad-1', decidedBy: 'ben@bfs.de' }), /500/);
    assert.strictEqual((await kiosk.byId(dritte.id)).state, 'requested');
  });
  await check('zweimal freigeben wird abgelehnt', async () => {
    await assert.rejects(() => kiosk.release(anforderung.id, { assignmentTargetId: 'ad-0007', decidedBy: 'ben@bfs.de' }), /schon/);
  });
  await check('zurückziehen ruft DELETE', async () => {
    const zurueck = await kiosk.withdraw(anforderung.id, { decidedBy: 'ben@bfs.de' });
    assert.strictEqual(zurueck.state, 'withdrawn');
    assert.deepStrictEqual(gerufen.at(-1), ['delete', 'rel-99']);
  });
  await check('eine offene Anforderung lässt sich nicht zurückziehen', async () => {
    const vierte = await kiosk.request({ username: 'e.vier', jobDefinitionId: 'job-chrome' });
    await assert.rejects(() => kiosk.withdraw(vierte.id, { decidedBy: 'ben@bfs.de' }), /freigegebene/);
  });
  await check('ablehnen hält die Begründung fest', async () => {
    const fuenfte = await kiosk.request({ username: 'f.fuenf', jobDefinitionId: 'job-chrome' });
    const abgelehnt = await kiosk.deny(fuenfte.id, { decidedBy: 'ben@bfs.de', note: 'nicht lizenziert' });
    assert.strictEqual(abgelehnt.state, 'denied');
    assert.strictEqual(abgelehnt.note, 'nicht lizenziert');
    assert.strictEqual(abgelehnt.decidedBy, 'ben@bfs.de');
  });
  await check('nach einer Ablehnung darf neu angefordert werden', async () => {
    const wieder = await kiosk.request({ username: 'f.fuenf', jobDefinitionId: 'job-chrome' });
    assert.strictEqual(wieder.state, 'requested');
  });
  await check('unbekannte Anforderung meldet sich als unbekannt', async () => {
    await assert.rejects(() => kiosk.deny(999999, { decidedBy: 'x' }), /unbekannt/);
  });

  await db.close();

  // Testdatenbank wegräumen.
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.end();

  console.log(`\n${passed} Prüfungen bestanden${process.exitCode ? ' — mit Fehlern' : ''}`);
}

main().catch((err) => {
  // Kein Postgres in Reichweite ist kein Fehlschlag des Geprueften, sondern
  // eine fehlende Voraussetzung. Ohne diese Unterscheidung sieht der Lauf auf
  // einem Rechner ohne Datenbank (etwa dem Mac) nach einem Defekt aus.
  const nichtErreichbar = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT'].includes(err.code)
    || /password authentication|role .* does not exist|getaddrinfo/i.test(err.message || '');
  if (nichtErreichbar) {
    console.log('ÜBERSPRUNGEN — kein Postgres erreichbar.');
    console.log(`  (${err.message})`);
    console.log('  Dieser Test braucht die Datenbank des Portals. Auf dem Host:');
    console.log('    docker compose cp tools bfs-portal-backend:/tmp/tools');
    console.log('    docker compose exec backend node /tmp/tools/db-test.js');
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});
