// Prüft den bConnect-Treiber gegen tools/bconnect-mock.js — in beiden
// Fassungen der Schnittstelle. Aufruf: node tools/bconnect-test.js
//
// Was hier NICHT geprüft wird: ob ein echter bMS-Server dieselben Formen
// spricht. Die Attrappe ist aus den Herstellermodulen abgeleitet, aber
// abgeleitet ist nicht dasselbe wie erprobt.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mock = require('./bconnect-mock');

// Eigener Datenordner, damit der Treiber nicht die echten gespeicherten
// Einstellungen des laufenden Portals liest (siehe atlassian-test.js).
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bfs-bconnect-'));
process.env.DATA_DIR = DATA_DIR;

const PORT = 8543;
process.env.BCONNECT_SERVER = '127.0.0.1';
process.env.BCONNECT_PORT = String(PORT);
process.env.BCONNECT_USER = mock.USER;
process.env.BCONNECT_PASSWORD = mock.PASS;
// Die Attrappe stellt ein selbst signiertes Zertifikat aus.
process.env.BCONNECT_ALLOW_SELF_SIGNED = 'true';
process.env.BCONNECT_ALLOWED_JOBS = 'gpupdate,Chrome Cache leeren';
// Ohne das würde jeder Lauf zehn Sekunden auf die Statusabfragen warten.
process.env.BCONNECT_POLL_MS = '20';

// Im Repo unter backend/drivers, im Container direkt unter /app/drivers.
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

/** Stellt den Treiber auf eine Fassung um. */
function fassung(version, { schluessel = false } = {}) {
  bconnect.CONFIG.version = version;
  bconnect.CONFIG.apiKey = schluessel ? mock.APIKEY : '';
  bconnect.CONFIG.user = schluessel ? '' : mock.USER;
  bconnect.CONFIG.password = schluessel ? '' : mock.PASS;
}

(async () => {
  await new Promise((r) => mock.server.listen(PORT, '127.0.0.1', r));

  for (const [name, version, schluessel] of [
    ['v1', 'v1.0', false],
    ['v2 mit Schlüssel', 'v2.0', true],
    ['v2 mit Basic', 'v2.0', false]
  ]) {
    console.log(`\n--- ${name} ---`);
    fassung(version, { schluessel });

    await check(`${name}: konfiguriert`, () => {
      assert.strictEqual(bconnect.isConfigured(), true);
    });

    await check(`${name}: Geräte kommen mit Namen an`, async () => {
      const geraete = await bconnect.listDevices();
      assert.strictEqual(geraete.length, 2);
      const namen = geraete.map((g) => g.hostname).sort();
      assert.deepStrictEqual(namen, ['PC-MUELLER', 'PC-SCHMIDT']);
      assert.ok(geraete.every((g) => g.deviceId), 'Gerät ohne Kennung');
      assert.ok(geraete.every((g) => g.driver === 'bconnect'));
    });

    await check(`${name}: nur freigegebene Jobs erscheinen`, async () => {
      const jobs = await bconnect.listJobs();
      const namen = jobs.map((j) => j.name).sort();
      assert.deepStrictEqual(namen, ['Chrome Cache leeren', 'gpupdate']);
      assert.ok(
        !namen.includes('Windows Feature Update'),
        'Der Rollout aus dem Katalog ist durchgerutscht'
      );
      assert.ok(jobs.every((j) => j.id), 'Job ohne Kennung');
    });

    await check(`${name}: Werkzeugliste führt nur freigegebene Namen`, async () => {
      const werkzeuge = await bconnect.toolDefinitions();
      const lauf = werkzeuge.find((w) => w.name === 'run_bms_job');
      assert.ok(lauf, 'run_bms_job fehlt');
      assert.deepStrictEqual(
        [...lauf.input_schema.properties.jobName.enum].sort(),
        ['Chrome Cache leeren', 'gpupdate']
      );
    });

    await check(`${name}: Job läuft und meldet Erfolg`, async () => {
      const geraete = await bconnect.listDevices();
      const ergebnis = await bconnect.execute(geraete[0].deviceId, 'run_bms_job', {
        jobName: 'gpupdate'
      });
      assert.strictEqual(ergebnis.exitCode, 0, `Ausgabe: ${ergebnis.output}`);
      assert.match(ergebnis.output, /gpupdate/);
      assert.match(ergebnis.output, /Instanz: inst-/);
    });

    await check(`${name}: installierte Software — nur v2 kann das`, async () => {
      const werkzeuge = await bconnect.toolDefinitions();
      const hat = werkzeuge.some((w) => w.name === 'list_installed_software');
      assert.strictEqual(hat, version.startsWith('v2'),
        `list_installed_software ${hat ? 'da' : 'fehlt'} bei ${version}`);

      if (!version.startsWith('v2')) {
        await assert.rejects(
          () => bconnect.execute('ep-0001', 'list_installed_software', {}),
          /nur über bConnect v2/
        );
        return;
      }

      const ergebnis = await bconnect.execute('ep-0001', 'list_installed_software', {});
      assert.strictEqual(ergebnis.exitCode, 0);
      assert.match(ergebnis.output, /Google Chrome 141\.0\.7390\.55 \(Google LLC\)/);
      assert.match(ergebnis.output, /7-Zip/);

      // Ein Gerät ohne Inventar darf keine leere Zeile liefern, sondern einen Satz.
      const leer = await bconnect.execute('ep-0002', 'list_installed_software', {});
      assert.match(leer.output, /keine Software inventarisiert/);
    });

    await check(`${name}: nicht freigegebener Job wird abgelehnt`, async () => {
      const geraete = await bconnect.listDevices();
      await assert.rejects(
        () => bconnect.execute(geraete[0].deviceId, 'run_bms_job', {
          jobName: 'Windows Feature Update'
        }),
        /nicht freigegeben/
      );
    });

    await check(`${name}: unbekannte Aktion wird abgelehnt`, async () => {
      await assert.rejects(
        () => bconnect.execute('ep-0001', 'rm_minus_rf', {}),
        /Unbekannte bConnect-Aktion/
      );
    });

    await check(`${name}: falsche Zugangsdaten kommen als Fehler durch`, async () => {
      const merk = { user: bconnect.CONFIG.user, pass: bconnect.CONFIG.password, key: bconnect.CONFIG.apiKey };
      bconnect.CONFIG.user = 'falsch';
      bconnect.CONFIG.password = 'falsch';
      bconnect.CONFIG.apiKey = 'falsch';
      await assert.rejects(() => bconnect.listDevices(), /HTTP 401/);
      Object.assign(bconnect.CONFIG, { user: merk.user, password: merk.pass, apiKey: merk.key });
    });
  }

  console.log('\n--- fassungsübergreifend ---');

  await check('leere Freigabeliste nimmt das Ausführen, nicht das Lesen', async () => {
    const merk = bconnect.CONFIG.allowedJobs;
    bconnect.CONFIG.allowedJobs = [];

    // v2: die Softwareliste bleibt, run_bms_job verschwindet.
    fassung('v2.0', { schluessel: true });
    const werkzeugeV2 = await bconnect.toolDefinitions();
    assert.deepStrictEqual(werkzeugeV2.map((w) => w.name), ['list_installed_software']);

    // v1 kennt nur Jobs — dort bleibt gar nichts übrig.
    fassung('v1.0');
    assert.deepStrictEqual(await bconnect.toolDefinitions(), []);

    await assert.rejects(
      () => bconnect.execute('ep-0001', 'run_bms_job', { jobName: 'gpupdate' }),
      /nicht freigegeben/
    );
    bconnect.CONFIG.allowedJobs = merk;
    fassung('v2.0', { schluessel: true });
  });

  await check('ohne Konfiguration wird nicht geraten', async () => {
    const merk = bconnect.CONFIG.server;
    bconnect.CONFIG.server = '';
    assert.strictEqual(bconnect.isConfigured(), false);
    assert.deepStrictEqual(await bconnect.listDevices(), []);
    assert.deepStrictEqual(await bconnect.listJobs(), []);
    await assert.rejects(
      () => bconnect.execute('ep-0001', 'run_bms_job', { jobName: 'gpupdate' }),
      /nicht konfiguriert/
    );
    bconnect.CONFIG.server = merk;
  });

  await check('v2 ohne Schlüssel und ohne Kennwort gilt als unkonfiguriert', () => {
    const merk = { user: bconnect.CONFIG.user, pass: bconnect.CONFIG.password, key: bconnect.CONFIG.apiKey };
    fassung('v2.0', { schluessel: false });
    bconnect.CONFIG.user = '';
    bconnect.CONFIG.password = '';
    assert.strictEqual(bconnect.isConfigured(), false);
    Object.assign(bconnect.CONFIG, { user: merk.user, password: merk.pass, apiKey: merk.key });
  });

  mock.server.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(`\n${passed} Prüfungen bestanden${process.exitCode ? ' — mit Fehlern' : ''}.`);
})();
