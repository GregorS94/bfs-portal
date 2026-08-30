// Prüft den Entra-Treiber gegen tools/entra-mock.js — ohne Mandanten.
// Aufruf: node tools/entra-test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mock = require('./entra-mock');

// Eigener Datenordner, damit der Treiber nicht die echten gespeicherten
// Einstellungen des laufenden Portals liest (siehe atlassian-test.js).
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bfs-entra-'));
process.env.DATA_DIR = DATA_DIR;

const PORT = mock.PORT;
process.env.ENTRA_AUTH_BASE = `http://127.0.0.1:${PORT}`;
process.env.ENTRA_GRAPH_BASE = `http://127.0.0.1:${PORT}`;
process.env.ENTRA_TENANT_ID = 'mock-tenant';
process.env.ENTRA_GRAPH_CLIENT_ID = 'mock-client';
process.env.ENTRA_GRAPH_CLIENT_SECRET = 'mock-secret';

// Im Repo unter backend/drivers, im Container direkt unter /app/drivers.
const entra = (() => {
  for (const p of ['../backend/drivers/entra', '/app/drivers/entra']) {
    try {
      return require(p);
    } catch (err) {
      if (err.code !== 'MODULE_NOT_FOUND') throw err;
    }
  }
  throw new Error('entra.js nicht gefunden');
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

(async () => {
  await new Promise((resolve) => mock.server.listen(PORT, '127.0.0.1', resolve));
  console.log('Entra-Treiber (gegen Attrappe)');

  await check('erkennt vollständige Konfiguration', () => {
    assert.strictEqual(entra.isConfigured(), true);
  });

  await check('registrierter Benutzer darf selbst zurücksetzen', async () => {
    const status = await entra.getSsprStatus('a.bereit@bfs.de');
    assert.strictEqual(status.found, true);
    assert.strictEqual(status.isSsprCapable, true);
    const t = entra.triage(status);
    assert.strictEqual(t.selfService, true);
    assert.strictEqual(t.url, entra.SSPR_PORTAL);
  });

  await check('freigeschaltet aber nicht registriert -> IT muss ran', async () => {
    const t = entra.triage(await entra.getSsprStatus('b.unregistriert@bfs.de'));
    assert.strictEqual(t.selfService, false);
    assert.strictEqual(t.reason, 'nicht registriert');
  });

  await check('per Richtlinie ausgeschlossen -> IT muss ran', async () => {
    const t = entra.triage(await entra.getSsprStatus('c.gesperrt@bfs.de'));
    assert.strictEqual(t.selfService, false);
    assert.strictEqual(t.reason, 'nicht freigeschaltet');
  });

  await check('unbekannter Benutzer wird sauber gemeldet', async () => {
    const status = await entra.getSsprStatus('niemand@bfs.de');
    assert.strictEqual(status.found, false);
    assert.strictEqual(entra.triage(status).reason, 'unbekannt');
  });

  await check('UPN wird validiert, bevor er in den Filter geht', async () => {
    const böse = [
      // Würde den OData-Filter aufbrechen und alle Benutzer liefern.
      "a.bereit@bfs.de' or startswith(userPrincipalName,'",
      "x@y.de' or isAdmin eq true or '",
      'ohne-at-zeichen',
      'a b@bfs.de',
      ''
    ];
    for (const upn of böse) {
      await assert.rejects(() => entra.getSsprStatus(upn), /Ungültiger UPN/);
    }
    // Kein einziger dieser Versuche darf die Attrappe erreicht haben.
    assert.ok(
      mock.seen.filters.every((f) => /^userPrincipalName eq '[^']*'$/.test(f)),
      `Filter durchgerutscht: ${JSON.stringify(mock.seen.filters)}`
    );
  });

  await check('ohne Konfiguration wird nicht geraten', async () => {
    const secret = process.env.ENTRA_GRAPH_CLIENT_SECRET;
    delete process.env.ENTRA_GRAPH_CLIENT_SECRET;
    entra.resetTokenCache();
    assert.strictEqual(entra.isConfigured(), false);
    await assert.rejects(() => entra.getSsprStatus('a.bereit@bfs.de'), /nicht konfiguriert/);
    process.env.ENTRA_GRAPH_CLIENT_SECRET = secret;
    entra.resetTokenCache();
  });

  mock.server.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(`\n${passed} Prüfungen bestanden${process.exitCode ? ' — mit Fehlern' : ''}.`);
})();
