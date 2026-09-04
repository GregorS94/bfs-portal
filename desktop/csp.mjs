// Schreibt eine Ergänzung zur Tauri-Konfiguration, die dem Programm erlaubt,
// mit genau einem Portal zu sprechen.
//
// Hintergrund: Im Programm ist der Ursprung `tauri://localhost`. Jeder Aufruf
// an das Portal ist damit ein fremder Ursprung, und die Inhaltsrichtlinie
// (CSP) muss ihn ausdrücklich nennen. Stünde die Adresse fest in
// tauri.conf.json, müsste man sie an zwei Stellen pflegen — und die zweite
// vergisst man. Also entsteht sie hier aus derselben Variablen, die auch die
// Oberfläche bekommt.
//
//   node csp.mjs            -> schreibt src-tauri/csp.json
//   node csp.mjs --pruefen  -> gibt die Zeile nur aus

import { writeFileSync } from 'node:fs';

const roh = process.env.VITE_API_BASE || '';
if (!roh) {
  console.error('VITE_API_BASE ist leer — ohne Portal-Adresse ist das Paket nicht brauchbar.');
  process.exit(1);
}

let ursprung;
try {
  ursprung = new URL(roh).origin;   // wirft, wenn kein Schema davorsteht
} catch {
  console.error(`VITE_API_BASE ist keine vollständige Adresse: ${roh}`);
  console.error('Erwartet wird etwas wie https://portal.bfs-abrechnung.de');
  process.exit(1);
}

const csp = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "script-src 'self' https://cdn.tailwindcss.com",
  `connect-src 'self' ipc: http://ipc.localhost ${ursprung}`
].join('; ');

if (process.argv.includes('--pruefen')) {
  console.log(csp);
} else {
  writeFileSync(new URL('./src-tauri/csp.json', import.meta.url),
    JSON.stringify({ app: { security: { csp } } }, null, 2) + '\n');
  console.log(`Inhaltsrichtlinie für ${ursprung} geschrieben.`);
}
