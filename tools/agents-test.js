#!/usr/bin/env node
//
// Prüft die Geräte-Token: Vergabe, Bindung an genau ein Gerät, Sperren.
//
// Eigenes DATA_DIR im Temp-Verzeichnis — nie gegen die echte agents.json.

const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-test-'));
process.env.DATA_DIR = DATA_DIR;

const agents = require(path.join(__dirname, '..', 'backend', 'agents.js'));

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

console.log('Geräte-Token');

const tokenA = agents.enroll('pc-a');
const tokenB = agents.enroll('pc-b');

check('Anmeldung liefert ein Token', typeof tokenA === 'string' && tokenA.length === 64);
check('zwei Geräte bekommen verschiedene Token', tokenA !== tokenB);
check('eigenes Token wird akzeptiert', agents.verify('pc-a', tokenA));

// Der eigentliche Zweck der Umstellung: ein abgegriffenes Token nützt nur für
// den Rechner, von dem es stammt.
check('fremdes Token wird abgewiesen', !agents.verify('pc-a', tokenB));
check('unbekanntes Gerät wird abgewiesen', !agents.verify('pc-c', tokenA));
check('leeres Token wird abgewiesen', !agents.verify('pc-a', ''));

const stored = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'agents.json'), 'utf8'));
check('Token steht nicht im Klartext auf der Platte',
  !JSON.stringify(stored).includes(tokenA));
check('Datei hat Rechte 0600',
  (fs.statSync(path.join(DATA_DIR, 'agents.json')).mode & 0o777) === 0o600);

// Rotation: erneute Anmeldung entwertet das alte Token.
const tokenA2 = agents.enroll('pc-a');
check('erneute Anmeldung vergibt ein neues Token', tokenA2 !== tokenA);
check('altes Token gilt nicht mehr', !agents.verify('pc-a', tokenA));
check('neues Token gilt', agents.verify('pc-a', tokenA2));

// Sperren.
check('Sperren meldet Erfolg', agents.revoke('pc-a'));
check('gesperrtes Gerät wird abgewiesen', !agents.verify('pc-a', tokenA2));
check('anderes Gerät bleibt unberührt', agents.verify('pc-b', tokenB));

// Ohne diese Regel wäre Sperren wirkungslos: wer das Anmelde-Token kennt,
// würde sich einfach neu anmelden.
let denied = false;
try {
  agents.enroll('pc-a');
} catch (err) {
  denied = err.code === 'REVOKED';
}
check('gesperrtes Gerät kann sich nicht neu anmelden', denied);

check('Sperren eines unbekannten Geräts schlägt fehl', !agents.revoke('pc-x'));

// Entsperren: das alte Token bleibt tot, das Gerät muss sich neu anmelden.
check('Entsperren meldet Erfolg', agents.unrevoke('pc-a'));
check('altes Token lebt nach dem Entsperren nicht wieder auf', !agents.verify('pc-a', tokenA2));
check('Prüfung ohne vergebenes Token stürzt nicht ab', agents.verify('pc-a', 'irgendwas') === false);
const tokenA3 = agents.enroll('pc-a');
check('nach dem Entsperren ist Anmeldung wieder möglich', agents.verify('pc-a', tokenA3));

const list = agents.list();
check('Übersicht kennt beide Geräte', list.length === 2);
check('Übersicht enthält keine Token und keine Hashes',
  !JSON.stringify(list).includes(tokenA3) && !/tokenHash/.test(JSON.stringify(list)));

fs.rmSync(DATA_DIR, { recursive: true, force: true });

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
