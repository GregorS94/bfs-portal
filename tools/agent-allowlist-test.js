// Prüft die Windows-Freigabeliste des Agenten.
//
// Der Agent führt bewusst eine eigene Liste, statt dem Portal zu glauben —
// wäre das Portal übernommen, ist sie die zweite Verteidigungslinie. Eine
// Verdopplung läuft aber still auseinander, sobald jemand in actions.js einen
// Befehl ändert. Genau das findet dieser Test.
//
// Zusätzlich wird `check_allowed` im Agenten selbst ausgeführt: einmal mit dem,
// was das Portal schickt, und einmal mit dem, was ein übernommenes Portal
// schicken würde.
//
//   node tools/agent-allowlist-test.js

const { execFileSync } = require('child_process');
const path = require('path');
const { ACTIONS } = require('../backend/actions');

const AGENT = path.join(__dirname, '..', 'agent', 'bfs-agent.py');
let fehler = 0;

function pruefe(name, bedingung, hinweis = '') {
  if (bedingung) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}${hinweis ? ' — ' + hinweis : ''}`);
    fehler++;
  }
}

/** Ruft eine Python-Zeile im Kontext des Agenten auf und gibt die Ausgabe zurück. */
function imAgenten(ausdruck) {
  const skript = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("bfs_agent", ${JSON.stringify(AGENT)})
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
print(json.dumps(${ausdruck}))
`;
  return JSON.parse(execFileSync('python3', ['-c', skript], { encoding: 'utf8' }).trim());
}

console.log('Freigabeliste: Portal gegen Agent');

// --- 1. Beide Listen müssen dieselben Skripttexte enthalten -------------------

const ausPortal = [];
for (const [name, aktion] of Object.entries(ACTIONS)) {
  if (!aktion.windows) continue;
  const befehl = aktion.windows({ service: 'X', identity: 'X' });
  pruefe(`${name}: ruft powershell.exe`, befehl.file === 'powershell.exe');
  pruefe(
    `${name}: fester Präfix`,
    JSON.stringify(befehl.args.slice(0, 3)) ===
      JSON.stringify(['-NoProfile', '-NonInteractive', '-Command'])
  );
  ausPortal.push(befehl.args[3]);
}

const imAgent = imAgenten('sorted(m.ALLOWED_POWERSHELL)');
const fehlend = ausPortal.filter((s) => !imAgent.includes(s));
const ueberzaehlig = imAgent.filter((s) => !ausPortal.includes(s));

pruefe(
  `alle ${ausPortal.length} Portal-Befehle stehen im Agenten`,
  fehlend.length === 0,
  fehlend.map((s) => s.slice(0, 60)).join(' | ')
);
pruefe(
  'der Agent erlaubt nichts, was das Portal nicht schickt',
  ueberzaehlig.length === 0,
  ueberzaehlig.map((s) => s.slice(0, 60)).join(' | ')
);

// --- 2. check_allowed im Agenten ---------------------------------------------

console.log('\nPrüfung im Agenten selbst');

// Der Agent entscheidet nach Betriebssystem. Für den Test wird die Windows-
// Liste gesetzt, damit er sich auf einem Linux-Prüfrechner wie auf Windows
// verhält.
function urteil(befehl) {
  return imAgenten(
    `(lambda _: m.check_allowed(${JSON.stringify(befehl)}))(m.__dict__.update({"ALLOWED": m.ALLOWED_WINDOWS}))`
  );
}

const echt = ACTIONS.get_service_status.windows({ service: 'Spooler' });
pruefe('echter Befehl mit Parameter wird erlaubt', urteil(echt) === null, String(urteil(echt)));

const ohneParam = ACTIONS.get_disk_space.windows({});
pruefe('echter Befehl ohne Parameter wird erlaubt', urteil(ohneParam) === null);

const fremdesSkript = {
  file: 'powershell.exe',
  args: ['-NoProfile', '-NonInteractive', '-Command', 'Remove-Item C:\\ -Recurse -Force']
};
pruefe('fremder PowerShell-Befehl wird abgelehnt', urteil(fremdesSkript) !== null);

const angehaengt = {
  file: 'powershell.exe',
  args: [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Get-PSDrive -PSProvider FileSystem | Format-Table -AutoSize; Remove-Item C:\\ -Recurse'
  ]
};
pruefe('angehängter Befehl wird abgelehnt', urteil(angehaengt) !== null);

const ohnePraefix = {
  file: 'powershell.exe',
  args: ['-Command', 'Get-PSDrive -PSProvider FileSystem | Format-Table -AutoSize']
};
pruefe('fehlender Präfix wird abgelehnt', urteil(ohnePraefix) !== null);

const encodedCommand = {
  file: 'powershell.exe',
  args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', 'RwBlAHQALQBQAHIAbwBjAGUAcwBz']
};
pruefe('-EncodedCommand wird abgelehnt', urteil(encodedCommand) !== null);

const boeserParameter = {
  file: 'powershell.exe',
  args: [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Get-Service -Name $args[0] | Format-List',
    'Spooler; Remove-Item C:\\'
  ]
};
pruefe('Parameter mit Sonderzeichen wird abgelehnt', urteil(boeserParameter) !== null);

const cmdExe = { file: 'cmd.exe', args: ['/c', 'dir'] };
pruefe('cmd.exe steht nicht auf der Liste', urteil(cmdExe) !== null);

// --- 3. Unter Linux darf PowerShell nicht durchkommen ------------------------

console.log('\nTrennung nach Betriebssystem');
const linuxUrteil = imAgenten(
  `(lambda _: m.check_allowed(${JSON.stringify(ohneParam)}))(m.__dict__.update({"ALLOWED": m.ALLOWED_LINUX}))`
);
pruefe('auf einem Linux-Gerät wird powershell.exe abgelehnt', linuxUrteil !== null);

const linuxEcht = imAgenten(
  `(lambda _: m.check_allowed({"file": "df", "args": ["-h"]}))(m.__dict__.update({"ALLOWED": m.ALLOWED_LINUX}))`
);
pruefe('auf einem Linux-Gerät bleibt df erlaubt', linuxEcht === null, String(linuxEcht));

console.log(fehler === 0 ? '\nAlle Prüfungen bestanden.' : `\n${fehler} Prüfung(en) fehlgeschlagen.`);
process.exit(fehler === 0 ? 0 : 1);
