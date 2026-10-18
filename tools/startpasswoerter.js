#!/usr/bin/env node
//
// Setzt die Startpasswoerter der ausgelieferten Konten zurueck — `admin/admin`
// und `user/1234`, beziehungsweise was in der .env steht.
//
// Warum als Werkzeug und nicht beim Start: beim Start waere es fatal. Ein
// Neustart duerfte niemals das Passwort eines echten Administrators
// ueberschreiben. Hier passiert es, weil jemand es ausdruecklich aufruft.
//
// Aufruf auf dem Host, in dem der Portal-Stapel laeuft:
//
//   docker compose cp tools backend:/tmp/tools
//   docker compose exec backend node /tmp/tools/startpasswoerter.js
//
// Ohne Argument betrifft es alle Konten aus db.SEEDS, mit Argumenten nur die
// genannten Anmeldenamen:
//
//   docker compose exec backend node /tmp/tools/startpasswoerter.js admin
//
// Die Token-Fassung zaehlt dabei hoch: laufende Sitzungen dieser Konten enden
// sofort. Das ist gewollt — ein zurueckgesetztes Passwort soll keine offene
// Sitzung weiterlaufen lassen.

const path = require('path');
const BACKEND = path.join(__dirname, '..', 'backend');
const db = require(require.resolve('./db', { paths: ['/app', BACKEND] }));
const users = require(require.resolve('./users', { paths: ['/app', BACKEND] }));
const accounts = require(require.resolve('./accounts', { paths: ['/app', BACKEND] }));

async function main() {
  if (!db.isConfigured()) {
    console.error('Keine Datenbank konfiguriert (DATABASE_URL oder DB_HOST).');
    process.exit(1);
  }

  const gewuenscht = process.argv.slice(2).map((s) => accounts.normalizeUsername(s));
  const betroffen = db.SEEDS.filter(
    (s) => !gewuenscht.length || gewuenscht.includes(accounts.normalizeUsername(s.username))
  );

  if (!betroffen.length) {
    console.error(`Kein Startkonto passt zu: ${gewuenscht.join(', ')}`);
    console.error(`Bekannt sind: ${db.SEEDS.map((s) => s.username).join(', ')}`);
    process.exit(1);
  }

  await db.init();

  for (const seed of betroffen) {
    const name = accounts.normalizeUsername(seed.username);
    const konto = await users.findForLogin(name);
    if (!konto) {
      // Ein geloeschtes Startkonto kommt hier nicht zurueck. Es neu anzulegen
      // waere eine andere Entscheidung als "Passwort zurueck" — und eine, die
      // niemand bestellt hat.
      console.log(`${name}: nicht vorhanden, uebersprungen.`);
      continue;
    }
    // `mustChange: true` markiert das Konto wieder als "ausgeliefertes
    // Passwort". Es erzwingt nichts, es macht den Zustand nur sichtbar.
    await users.setPassword(konto.id, seed.password, { mustChange: true });
    console.log(`${name}: Passwort steht wieder auf "${seed.password}".`);
  }

  await db.close();
}

main().catch(async (err) => {
  console.error('Fehlgeschlagen:', err.message);
  await db.close().catch(() => {});
  process.exit(1);
});
