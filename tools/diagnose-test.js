#!/usr/bin/env node
//
// Prüft die Auswertung der Diagnose-Ausgaben: aus Konsolentext werden Zahl,
// Status und ein Satz für den Teams-Chat. Reine Funktionen, kein Gerät nötig.

const path = require('path');
const d = require(path.join(__dirname, '..', 'backend', 'diagnose.js'));

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

const DF_VOLL = `Dateisystem    Größe Benutzt Verf. Verw% Eingehängt auf
udev            3,8G       0  3,8G    0% /dev
/dev/sda1       100G     94G  6,0G   94% /
/dev/sda2       200G     10G  190G    5% /daten`;

const DF_LEER = `Dateisystem    Größe Benutzt Verf. Verw% Eingehängt auf
/dev/sda1       100G     42G   58G   42% /`;

const DF_OHNE_PROZENT = `Filesystem Size Used Avail Mounted on
/dev/sda1  100G 95G  5G   /`;

const PSDRIVE = `Name     Used (GB)     Free (GB) Provider      Root
----     ---------     --------- --------      ----
C           120,45         38,21 FileSystem    C:\\
D             1,00        500,00 FileSystem    D:\\`;

const FREE = `              total        used        free      shared
Mem:          7,7Gi       5,9Gi       0,5Gi       0,1Gi
Swap:         2,0Gi          0B       2,0Gi`;

const CIM = `TotalVisibleMemorySize : 16000000
FreePhysicalMemory     : 1600000`;

console.log('Systemlaufwerk');
check('volle Platte wird gewarnt', d.parseDisk(DF_VOLL).status === 'warning');
check('Prozentwert kommt aus der Zeile mit /', d.parseDisk(DF_VOLL).used === 94);
check('Satz nennt die Zahl', d.parseDisk(DF_VOLL).label.includes('94%'));
check('zweites Dateisystem verwirrt nicht', d.parseDisk(DF_VOLL).used !== 5);
check('freie Platte ist ok', d.parseDisk(DF_LEER).status === 'ok' && d.parseDisk(DF_LEER).used === 42);
check('ohne Prozentspalte wird gerechnet', d.parseDisk(DF_OHNE_PROZENT).used === 95,
  JSON.stringify(d.parseDisk(DF_OHNE_PROZENT)));
check('Windows-Ausgabe wird erkannt', d.parseDisk(PSDRIVE).used === 76, JSON.stringify(d.parseDisk(PSDRIVE)));
check('Windows: Laufwerk C statt D', d.parseDisk(PSDRIVE).used !== 0);

console.log('\nArbeitsspeicher');
check('free -h wird gelesen', d.parseMemory(FREE).used === 77, JSON.stringify(d.parseMemory(FREE)));
check('77% gelten als unauffällig', d.parseMemory(FREE).status === 'ok');
check('Windows-Ausgabe wird gelesen', d.parseMemory(CIM).used === 90, JSON.stringify(d.parseMemory(CIM)));
check('90% schlägt an', d.parseMemory(CIM).status === 'warning');

console.log('\nNicht Gemessenes wird nicht behauptet');
for (const [name, fn] of [['Platte', d.parseDisk], ['Speicher', d.parseMemory]]) {
  for (const [form, text] of [['leer', ''], ['Müll', 'bash: df: Kommando nicht gefunden'], ['null', null]]) {
    const r = fn(text);
    check(`${name}/${form}: used ist null`, r.used === null, JSON.stringify(r));
    check(`${name}/${form}: Status unknown`, r.status === 'unknown');
  }
}

console.log('\nEinheiten');
check('Gi wird zu Byte', d.toBytes('1Gi') === 1024 ** 3);
check('Komma wie Punkt', d.toBytes('1,5G') === 1.5 * 1024 ** 3);
check('reine Zahl ohne Einheit', d.toBytes('512') === 512);
check('Unsinn ergibt null', d.toBytes('viel') === null);
check('Teilung durch null ergibt null', d.percent(5, 0) === null);

console.log('\nZusammenfassung eines Auftrags');
check('letzte Zeile gewinnt', d.summarise({ output: 'erste\nletzte Zeile\n' }) === 'letzte Zeile');
check('Fehler schlägt Ausgabe', d.summarise({ output: 'x', error: 'Zeitüberschreitung' }) === 'Zeitüberschreitung');
check('ohne Ausgabe ein Satz', d.summarise({ output: '' }) === 'Ohne Ausgabe abgeschlossen.');
check('wird gekürzt', d.summarise({ output: 'x'.repeat(500) }).length === 300);
check('ohne Auftrag null', d.summarise(null) === null);

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
