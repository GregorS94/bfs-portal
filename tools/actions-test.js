// Prüft die Aktionsliste: welche Aktionen es gibt, dass sie im Chat wählbar
// sind und dass die entfernten Kontoaktionen nicht zurückkommen.
// Aufruf auf dem Pi: node tools/actions-test.js
const assert = require('assert');
// Im Repo liegt actions.js unter backend/, im Container direkt neben /app/tools.
const actions = (() => {
  for (const p of ['../backend/actions', '../actions', '/app/actions']) {
    try {
      return require(p);
    } catch (err) {
      if (err.code !== 'MODULE_NOT_FOUND') throw err;
    }
  }
  throw new Error('actions.js nicht gefunden');
})();
const { ACTIONS, toolDefinitions, resolveCommand } = actions;

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

// Der Grund zählt: sonst besteht die Prüfung auch dann, wenn die Aktion gar
// nicht ausgerollt ist — "Unbekannte Aktion" wirft schließlich ebenfalls.
function rejects(action, params, platform, expected) {
  assert.throws(
    () => resolveCommand(action, params, platform),
    (err) => {
      assert.ok(
        expected.test(err.message),
        `unerwarteter Grund: ${err.message}`
      );
      return true;
    }
  );
}

console.log('Aktionsliste');

// Der Umfang ist eine bewusste Festlegung, kein Zufall: Chat und Prüfung am
// Gerät. Kontoaktionen wurden am 2026-09-17 entfernt (siehe FAHRPLAN.md).
const ERWARTET = [
  'get_disk_space', 'get_memory', 'get_uptime', 'get_service_status',
  'get_top_processes', 'get_failed_units', 'restart_service', 'clear_journal_logs'
];

check('genau die erwarteten Aktionen sind registriert', () => {
  assert.deepStrictEqual(Object.keys(ACTIONS).sort(), [...ERWARTET].sort());
});

check('die Kontoaktionen sind weg und kommen nicht zurück', () => {
  // Das ist der eigentliche Zweck dieser Prüfung: ein Wiedereinbau aus Versehen
  // wäre sonst nicht zu bemerken. reset_ad_password baut ein Einmal-Passwort,
  // das über tool_result in den Chatverlauf geraten könnte.
  for (const name of ['get_ad_account_status', 'unlock_ad_account', 'reset_ad_password']) {
    assert.ok(!ACTIONS[name], `${name} ist wieder da`);
    // "Unbekannte Aktion" ist hier der richtige Grund — die Aktion existiert
    // nicht mehr, sie ist nicht bloss auf dieser Plattform undefiniert.
    rejects(name, { identity: 'm.mustermann' }, 'windows', /Unbekannte Aktion/);
  }
});

check('alle Aktionen sind im Chat wählbar', () => {
  const chatTools = toolDefinitions().map((t) => t.name);
  assert.deepStrictEqual(chatTools.sort(), [...ERWARTET].sort());
});

check('schreibende Aktionen sind als solche gekennzeichnet', () => {
  // Daran hängt die Freigabe: ohne `risk: 'write'` liefe der Eingriff ohne
  // Rückfrage durch.
  for (const name of ['restart_service', 'clear_journal_logs']) {
    assert.strictEqual(ACTIONS[name].risk, 'write', name);
  }
  for (const name of ERWARTET.filter((n) => n.startsWith('get_'))) {
    assert.strictEqual(ACTIONS[name].risk, 'read', name);
  }
});

check('jede Aktion kennt beide Plattformen', () => {
  for (const name of ERWARTET) {
    assert.ok(typeof ACTIONS[name].linux === 'function', `${name}: linux fehlt`);
    assert.ok(typeof ACTIONS[name].windows === 'function', `${name}: windows fehlt`);
  }
});

check('Dienstnamen werden validiert', () => {
  for (const service of ['sshd; rm -rf /', 'a b', '', 'x'.repeat(300)]) {
    rejects('restart_service', { service }, 'linux', /Ungültig|ungültig/);
  }
});

console.log(`\n${passed} Prüfungen bestanden${process.exitCode ? ' — mit Fehlern' : ''}.`);
