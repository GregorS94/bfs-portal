#!/usr/bin/env node
//
// Prüft die Kiosk-Funktionen des bConnect-Treibers gegen tools/bconnect-mock.js.
// Aufruf: node tools/kiosk-test.js
//
// Was hier NICHT geprüft wird: ob ein echter bMS-Server dieselben Formen
// spricht. Belegt sind inzwischen alle benutzten Pfade — POST und DELETE
// /v2.0/KioskReleases, die vier Leseendpunkte und die Verzeichnissuche —
// mechanisch aus dem signierten Herstellermodul gelesen, siehe
// docs/BARAMUNDI_V2_ENDPUNKTE.md. Der erste Lauf gegen den echten Server
// steht aus.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mock = require('./bconnect-mock');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bfs-kiosk-'));
process.env.DATA_DIR = DATA_DIR;

const PORT = 8544;
process.env.BCONNECT_SERVER = '127.0.0.1';
process.env.BCONNECT_PORT = String(PORT);
process.env.BCONNECT_API_KEY = mock.APIKEY;
process.env.BCONNECT_ALLOW_SELF_SIGNED = 'true';
process.env.BCONNECT_VERSION = 'v2.0';
// Nur diese beiden Jobs dürfen im Kiosk freigegeben werden. "Windows Feature
// Update" steht bewusst NICHT drin.
process.env.BCONNECT_KIOSK_JOBS = 'gpupdate,Chrome Cache leeren';

const bconnect = (() => {
  for (const p of ['../backend/drivers/bconnect', '/app/drivers/bconnect']) {
    try {
      return require(p);
    } catch (err) {
      if (err.code !== 'MODULE_NOT_FOUND') throw err;
    }
  }
  throw new Error('bconnect.js nicht gefunden');
})();

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

async function main() {
  await new Promise((r) => mock.server.listen(PORT, '127.0.0.1', r));

  console.log('Adresse der Kiosk-Oberfläche');
  await check('wird aus der Serveradresse gebildet', () => {
    assert.strictEqual(bconnect.kioskWebUrl(), 'https://127.0.0.1/bWebServer/Kiosk');
  });
  await check('eine gesetzte Adresse gewinnt', () => {
    bconnect.CONFIG.kioskUrl = 'https://bms.bfs.intern/bWebServer/Kiosk/';
    assert.strictEqual(bconnect.kioskWebUrl(), 'https://bms.bfs.intern/bWebServer/Kiosk');
    bconnect.CONFIG.kioskUrl = '';
  });

  console.log('\nKatalog');
  await check('nur freigebbare Jobs stehen drin', async () => {
    const jobs = await bconnect.listKioskJobs();
    assert.deepStrictEqual(jobs.map((j) => j.name).sort(), ['Chrome Cache leeren', 'gpupdate']);
  });
  await check('gefährlicher Job ist nicht dabei', async () => {
    const jobs = await bconnect.listKioskJobs();
    assert.ok(!jobs.some((j) => j.name === 'Windows Feature Update'));
  });
  await check('Beschreibung kommt mit', async () => {
    const jobs = await bconnect.listKioskJobs();
    assert.ok(jobs.find((j) => j.name === 'gpupdate').comment.length > 0);
  });
  await check('leere Freigabeliste heißt: Kiosk aus', async () => {
    const vorher = bconnect.CONFIG.kioskJobs;
    bconnect.CONFIG.kioskJobs = [];
    assert.strictEqual(bconnect.kioskReady(), false);
    assert.deepStrictEqual(await bconnect.listKioskJobs(), []);
    bconnect.CONFIG.kioskJobs = vorher;
  });
  await check('v1 kennt keine Kiosk-Freigaben', async () => {
    bconnect.CONFIG.version = 'v1.0';
    assert.strictEqual(bconnect.kioskReady(), false);
    await assert.rejects(() => bconnect.createKioskRelease({ assignmentTargetId: 'a', jobDefinitionId: 'b' }));
    bconnect.CONFIG.version = 'v2.0';
  });

  console.log('\nFreigabe erteilen');
  let freigabe;
  await check('POST liefert eine Kennung', async () => {
    freigabe = await bconnect.createKioskRelease({
      assignmentTargetId: 'ad-0001', jobDefinitionId: 'job-gpupdate'
    });
    assert.ok(freigabe.id, 'keine Kennung zurückgekommen');
  });
  await check('die Attrappe hat genau die zwei Pflichtfelder bekommen', () => {
    const gespeichert = mock.kioskReleases.get(freigabe.id);
    assert.deepStrictEqual(Object.keys(gespeichert).sort(),
      ['assignmentTargetId', 'id', 'jobDefinitionId']);
    assert.strictEqual(gespeichert.assignmentTargetId, 'ad-0001');
    assert.strictEqual(gespeichert.jobDefinitionId, 'job-gpupdate');
  });
  await check('fehlendes Zuweisungsziel wird im Treiber abgefangen', async () => {
    await assert.rejects(() => bconnect.createKioskRelease({ jobDefinitionId: 'job-gpupdate' }),
      /assignmentTargetId/);
  });
  await check('fehlende Jobdefinition wird im Treiber abgefangen', async () => {
    await assert.rejects(() => bconnect.createKioskRelease({ assignmentTargetId: 'ad-0001' }),
      /jobDefinitionId/);
  });
  await check('ein Server-Fehler kommt mit Kontext durch', async () => {
    // Pfad umbiegen geht nicht ohne Umbau — stattdessen ein falscher Schlüssel.
    const echt = bconnect.CONFIG.apiKey;
    bconnect.CONFIG.apiKey = 'falsch';
    await assert.rejects(
      () => bconnect.createKioskRelease({ assignmentTargetId: 'a', jobDefinitionId: 'b' }),
      /HTTP 401/
    );
    bconnect.CONFIG.apiKey = echt;
  });

  console.log('\nFreigaben lesen');
  await check('die bMS listet die eigene Freigabe', async () => {
    const alle = await bconnect.listKioskReleases();
    assert.ok(alle.some((f) => f.id === freigabe.id), 'Freigabe fehlt in der Liste');
  });
  await check('je Jobdefinition gefiltert', async () => {
    const gespeichert = mock.kioskReleases.get(freigabe.id);
    const zumJob = await bconnect.listKioskReleases({ jobDefinitionId: gespeichert.jobDefinitionId });
    assert.ok(zumJob.length >= 1);
    assert.ok(zumJob.every((f) => f.jobDefinitionId === gespeichert.jobDefinitionId));
    // Ein fremder Job darf nichts liefern — sonst filtert der Pfad nicht,
    // sondern der Zufall.
    const fremd = await bconnect.listKioskReleases({ jobDefinitionId: 'job-gibtsnicht' });
    assert.strictEqual(fremd.length, 0);
  });

  console.log('\nZuweisungsziele suchen');
  await check('Anmeldename findet den AD-Benutzer mit Kennung', async () => {
    const gruppen = await bconnect.findAssignmentTargets('anna.mueller');
    const benutzer = gruppen.find((g) => g.quelle === 'AD-Benutzer');
    assert.strictEqual(benutzer.ziele.length, 1);
    assert.strictEqual(benutzer.ziele[0].id, 'ad-0001');
    assert.strictEqual(benutzer.ziele[0].name, 'anna.mueller');
    // Die Feldnamen der echten bMS sind unbekannt — deshalb muessen sie
    // mitkommen, damit man sie in der Oberflaeche ablesen kann statt zu raten.
    assert.ok(benutzer.ziele[0].felder.includes('samAccountName'));
  });
  await check('Teiltreffer über den Anzeigenamen', async () => {
    const gruppen = await bconnect.findAssignmentTargets('Schmidt');
    assert.strictEqual(gruppen.find((g) => g.quelle === 'AD-Benutzer').ziele[0].id, 'ad-0002');
  });
  await check('Objekte kommen als eigene Gruppe', async () => {
    const gruppen = await bconnect.findAssignmentTargets('PC-MUELLER');
    const objekte = gruppen.find((g) => g.quelle === 'AD-Objekt');
    assert.strictEqual(objekte.ziele[0].id, 'ado-0001');
  });
  await check('ein Zeichen wird gar nicht gesucht', async () => {
    // Sonst liefert eine Freitextsuche das halbe Verzeichnis zurück.
    await assert.rejects(() => bconnect.findAssignmentTargets('a'), /zwei Zeichen/);
  });
  await check('ohne Treffer bleibt die Gruppe leer statt zu scheitern', async () => {
    const gruppen = await bconnect.findAssignmentTargets('gibtesnichtimverzeichnis');
    assert.ok(gruppen.every((g) => g.ziele.length === 0));
    assert.ok(gruppen.every((g) => !g.problem), 'kein Treffer ist kein Fehler');
  });

  console.log('\nFreigabe zurückziehen');
  await check('DELETE entfernt sie', async () => {
    await bconnect.deleteKioskRelease(freigabe.id);
    assert.ok(!mock.kioskReleases.has(freigabe.id));
  });
  await check('zweimal zurückziehen meldet 404', async () => {
    await assert.rejects(() => bconnect.deleteKioskRelease(freigabe.id), /HTTP 404/);
  });
  await check('ohne Kennung wird gar nicht gerufen', async () => {
    await assert.rejects(() => bconnect.deleteKioskRelease(''), /Kennung/);
  });

  mock.server.close();
  console.log(`\n${passed} Prüfungen bestanden${process.exitCode ? ' — mit Fehlern' : ''}`);
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
