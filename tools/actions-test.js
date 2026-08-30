// Prüft die AD-Kontoaktionen ohne Windows: Befehlsform, Validierung und
// die Zusicherung, dass sie nicht im Chat auftauchen.
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

console.log('AD-Kontoaktionen');

check('die drei Aktionen sind registriert', () => {
  for (const name of ['get_ad_account_status', 'unlock_ad_account', 'reset_ad_password']) {
    assert.ok(ACTIONS[name], `${name} fehlt`);
  }
});

check('keine davon ist im Chat wählbar', () => {
  const chatTools = toolDefinitions().map((t) => t.name);
  for (const name of ['get_ad_account_status', 'unlock_ad_account', 'reset_ad_password']) {
    assert.ok(!chatTools.includes(name), `${name} taucht in toolDefinitions auf`);
  }
  // Die bestehenden Aktionen müssen weiterhin drin sein.
  assert.ok(chatTools.includes('get_disk_space'));
  assert.ok(chatTools.includes('restart_service'));
  assert.strictEqual(chatTools.length, Object.keys(ACTIONS).length - 3);
});

check('Entsperren baut den erwarteten Befehl', () => {
  const cmd = resolveCommand('unlock_ad_account', { identity: 'm.mustermann' }, 'windows');
  assert.strictEqual(cmd.file, 'powershell.exe');
  // Der Kontoname steht als eigenes argv-Element, nicht im Befehlstext.
  assert.strictEqual(cmd.args[cmd.args.length - 1], 'm.mustermann');
  assert.ok(cmd.args[3].includes('Unlock-ADAccount'));
  assert.ok(!cmd.args[3].includes('m.mustermann'), 'Name wurde in den Befehl interpoliert');
});

check('Zurücksetzen erzwingt Wechsel bei der nächsten Anmeldung', () => {
  const cmd = resolveCommand('reset_ad_password', { identity: 'm.mustermann@bfs.de' }, 'windows');
  const script = cmd.args[3];
  assert.ok(script.includes('Set-ADAccountPassword'));
  assert.ok(script.includes('ChangePasswordAtLogon $true'));
  assert.ok(script.includes('RandomNumberGenerator'), 'Passwort muss auf dem Ziel entstehen');
});

check('das Passwort ist kein Parameter', () => {
  // Parameter landen im Audit-Log (jobs.js, job.created). Ein Passwortfeld
  // im Schema wäre genau der Weg, auf dem es dort hineinkäme.
  for (const name of ['reset_ad_password', 'unlock_ad_account', 'get_ad_account_status']) {
    const props = Object.keys(ACTIONS[name].input_schema.properties);
    assert.deepStrictEqual(props, ['identity'], `${name} hat unerwartete Felder: ${props}`);
    assert.strictEqual(ACTIONS[name].input_schema.additionalProperties, false);
  }
});

check('unter Linux gibt es diese Aktionen nicht', () => {
  for (const name of ['get_ad_account_status', 'unlock_ad_account', 'reset_ad_password']) {
    rejects(name, { identity: 'm.mustermann' }, 'linux', /nicht definiert/);
  }
});

check('Kontonamen werden validiert', () => {
  const böse = [
    'm.mustermann; Remove-ADUser',
    'CN=Admin,DC=bfs,DC=de',
    'admin)(objectClass=*',
    'domain\\admin',
    'm mustermann',
    '',
    'a'.repeat(300)
  ];
  for (const identity of böse) {
    rejects('unlock_ad_account', { identity }, 'windows', /Ungültiger Kontoname/);
  }
});

check('gültige Namen kommen durch', () => {
  for (const identity of ['m.mustermann', 'm.mustermann@bfs.de', 'svc-backup_01']) {
    assert.ok(resolveCommand('get_ad_account_status', { identity }, 'windows'));
  }
});

console.log(`\n${passed} Prüfungen bestanden${process.exitCode ? ' — mit Fehlern' : ''}.`);
