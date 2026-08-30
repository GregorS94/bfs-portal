// Prüft den Einstellungsspeicher: Vorrang gegenüber der `.env`, Umgang mit
// Geheimnissen, Dateirechte. Aufruf: node tools/settings-test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bfs-settings-'));
process.env.DATA_DIR = DIR;
process.env.ATLASSIAN_BASE_URL = 'https://aus-der-env.atlassian.net';
process.env.ATLASSIAN_API_TOKEN = 'token-aus-der-env';
delete process.env.JIRA_PROJECT_KEY;

const settings = (() => {
  for (const p of ['../backend/settings', '/app/settings']) {
    try {
      return require(p);
    } catch (err) {
      if (err.code !== 'MODULE_NOT_FOUND') throw err;
    }
  }
  throw new Error('settings.js nicht gefunden');
})();

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.log(`  FAIL ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('Einstellungsspeicher');

check('ohne gespeicherten Wert gilt die .env', () => {
  assert.strictEqual(settings.value('atlassian', 'baseUrl'), 'https://aus-der-env.atlassian.net');
});

check('Vorgabewert greift, wenn weder Datei noch .env etwas hat', () => {
  assert.strictEqual(settings.value('atlassian', 'issueType'), 'Aufgabe');
});

check('gespeicherter Wert schlägt die .env', () => {
  settings.update('atlassian', { baseUrl: 'https://gespeichert.atlassian.net' });
  assert.strictEqual(settings.value('atlassian', 'baseUrl'), 'https://gespeichert.atlassian.net');
});

check('leerer String lässt den Wert unangetastet', () => {
  // Das Formular kennt das Geheimnis nie im Klartext. Würde ein leeres Feld
  // löschen, wäre nach jedem Speichern das Token weg.
  settings.update('atlassian', { apiToken: 'geheim-aus-der-oberflaeche' });
  settings.update('atlassian', { apiToken: '', baseUrl: 'https://neu.atlassian.net' });
  assert.strictEqual(settings.value('atlassian', 'apiToken'), 'geheim-aus-der-oberflaeche');
  assert.strictEqual(settings.value('atlassian', 'baseUrl'), 'https://neu.atlassian.net');
});

check('null löscht und fällt auf die .env zurück', () => {
  settings.update('atlassian', { apiToken: null });
  assert.strictEqual(settings.value('atlassian', 'apiToken'), 'token-aus-der-env');
});

check('unbekannte Felder werden ignoriert, nicht gespeichert', () => {
  settings.update('atlassian', { boesesFeld: 'wert', __proto__: 'x' });
  const saved = JSON.parse(fs.readFileSync(settings.FILE, 'utf8'));
  assert.ok(!('boesesFeld' in saved.atlassian), 'fremdes Feld ist in der Datei gelandet');
});

check('unbekannter Bereich wird abgelehnt', () => {
  assert.throws(() => settings.update('gibtsnicht', { x: 'y' }), /Unbekannter Bereich/);
});

check('Geheimnisse verlassen den Speicher nicht', () => {
  settings.update('atlassian', { apiToken: 'streng-geheim-123' });
  const view = settings.redact('atlassian');
  const text = JSON.stringify(view);
  assert.ok(!text.includes('streng-geheim-123'), 'Geheimnis ist in der Ansicht gelandet');
  assert.strictEqual(view.secrets.apiToken.set, true);
  assert.ok(!('apiToken' in view.fields), 'Geheimnis steht bei den normalen Feldern');
  // Nicht-geheime Werte sollen dagegen sichtbar sein.
  assert.strictEqual(view.fields.baseUrl.value, 'https://neu.atlassian.net');
});

check('redactAll deckt alle Bereiche ab und enthält kein Geheimnis', () => {
  settings.update('entra', { clientSecret: 'auch-geheim-456', tenantId: 'abc-123' });
  const all = settings.redactAll();
  assert.deepStrictEqual(Object.keys(all).sort(), ['atlassian', 'entra']);
  assert.ok(!JSON.stringify(all).includes('auch-geheim-456'));
  assert.strictEqual(all.entra.fields.tenantId.value, 'abc-123');
  assert.strictEqual(all.entra.secrets.clientSecret.set, true);
});

check('die Datei ist nur für den Besitzer lesbar', () => {
  const mode = fs.statSync(settings.FILE).mode & 0o777;
  assert.strictEqual(mode, 0o600, `Rechte sind ${mode.toString(8)}, erwartet 600`);
});

check('nach einem Neustart stehen die Werte noch da', () => {
  settings.reload();
  assert.strictEqual(settings.value('atlassian', 'apiToken'), 'streng-geheim-123');
  assert.strictEqual(settings.value('entra', 'tenantId'), 'abc-123');
});

fs.rmSync(DIR, { recursive: true, force: true });
console.log(`\n${passed} Prüfungen bestanden${process.exitCode ? ' — mit Fehlern' : ''}.`);
