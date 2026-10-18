#!/usr/bin/env node
//
// Entdeckungswerkzeug fuer bConnect v2 — es fragt den echten bMS-Server, was
// er kann, statt es zu raten.
//
// Warum es das gibt: die Pfade der Schnittstelle sind inzwischen belegt (siehe
// docs/BARAMUNDI_V2_ENDPUNKTE.md, aus dem signierten Herstellermodul
// gelesen). Drei Dinge stehen dort aber NICHT drin und koennen auch nirgends
// stehen, weil sie von der Installation abhaengen:
//
//   1. Welche Bereiche bei euch lizenziert und eingeschaltet sind.
//   2. Wie die Felder der Antworten heissen (im Modul sind nur die Rumpfe zum
//      Anlegen modelliert, nicht die Rueckgaben).
//   3. Ob der Schluessel oder das Dienstkonto die noetigen Rechte hat.
//
// Das Werkzeug fragt AUSSCHLIESSLICH LESEND. Es gibt in diesem Programm kein
// POST, kein PATCH und kein DELETE — nachpruefbar: es ruft `hole()`, und die
// Methode steht dort fest auf GET. Es legt nichts an, startet keinen Job und
// erteilt keine Freigabe. Gegen einen Produktivserver ist es damit so
// gefaehrlich wie ein Blick in die Konsole.
//
// Aufruf:
//
//   BCONNECT_SERVER=bms.firma.intern \
//   BCONNECT_API_KEY=… \
//   node tools/bconnect-entdecken.js
//
// Statt des Schluessels gehen auch BCONNECT_USER + BCONNECT_PASSWORD.
// Weitere Schalter:
//   BCONNECT_PORT=8443                   abweichender Port
//   BCONNECT_ALLOW_SELF_SIGNED=true      eigenes Zertifikat zulassen
//   BCONNECT_PROBE_USER=vorname.nachname ein Anmeldename zum Nachschlagen
//   BCONNECT_REPORT=/pfad/bericht.json   Bericht als JSON ablegen
//
// Der Bericht enthaelt Feldnamen und Statuswerte, aber bewusst KEINE
// Beispieldaten aus der bMS: Geraetenamen und Benutzer sind in einer
// Abrechnungsumgebung personenbezogen. Was ausgegeben wird, sind Schluessel
// von Objekten, nicht ihre Werte.

const https = require('https');
const fs = require('fs');
const { URL } = require('url');

const C = {
  server: process.env.BCONNECT_SERVER || '',
  port: process.env.BCONNECT_PORT || '443',
  apiKey: process.env.BCONNECT_API_KEY || '',
  user: process.env.BCONNECT_USER || '',
  password: process.env.BCONNECT_PASSWORD || '',
  allowSelfSigned: process.env.BCONNECT_ALLOW_SELF_SIGNED === 'true',
  probeUser: process.env.BCONNECT_PROBE_USER || '',
  report: process.env.BCONNECT_REPORT || ''
};

// Die zwoelf Bereiche mit je einem Listenendpunkt, der ohne Kennung auskommt.
// Quelle: Modulordner in bConnectV2 (siehe docs/BARAMUNDI_V2_ENDPUNKTE.md).
const BEREICHE = [
  ['activedirectory', '/v2.0/ADUsers'],
  ['assets', '/v2.0/Assets'],
  ['compliance', '/v2.0/Rules'],
  ['defensecontrol', '/v2.0/MicrosoftDefender/Threats'],
  ['endpoints', '/v2.0/Endpoints'],
  ['jobs', '/v2.0/JobDefinitions'],
  ['operatingsystems', '/v2.0/WindowsEndpoints'],
  ['servermanagement', '/v2.0/ManagementServer'],
  ['software', '/v2.0/InstalledWindowsSoftware'],
  ['universaldynamicgroups', '/v2.0/UniversalDynamicGroups'],
  ['updatemanagement', '/v2.0/WindowsEndpoints'],
  ['variables', '/v2.0/VariableDefinitions']
];

// Was fuer den Kiosk-Ablauf des Portals wirklich gebraucht wird.
const KIOSK = [
  ['jobs', '/v2.0/KioskReleases', 'Freigaben lesen — das Gegenstueck zu POST /KioskReleases'],
  ['jobs', '/v2.0/JobDefinitions', 'Softwarekatalog'],
  ['activedirectory', '/v2.0/ADUsers', 'Anmeldename → AD-Benutzer'],
  ['activedirectory', '/v2.0/ADObjects', 'Zuweisungsziel (assignmentTargetId)'],
  ['endpoints', '/v2.0/Endpoints', 'Geraete']
];

// Kandidaten fuer eine maschinenlesbare Beschreibung. Das Modul ist mit
// openapi-generator gebaut, also existiert eine Beschreibung — ob der Server
// sie auch ausliefert, ist offen. Faendet sie sich, waere sie die beste Quelle
// fuer die Feldnamen.
const BESCHREIBUNGEN = [
  '/bconnect/jobs/swagger/v2.0/swagger.json',
  '/bconnect/jobs/swagger/v1/swagger.json',
  '/bconnect/jobs/swagger.json',
  '/bconnect/jobs/openapi.json',
  '/bconnect/jobs/v2.0/swagger.json',
  '/bconnect/swagger/v2.0/swagger.json',
  '/bconnect/swagger/index.html'
];

const kopf = () => {
  const h = { Accept: 'application/json' };
  // Dieselbe Rangfolge wie Add-SecurityHeader.ps1 im Herstellermodul: ist ein
  // Benutzername gesetzt, gewinnt Basic — sonst der Schluessel.
  if (C.user && C.password) {
    h.Authorization = 'Basic ' + Buffer.from(`${C.user}:${C.password}`).toString('base64');
  } else if (C.apiKey) {
    h['X-API-KEY'] = C.apiKey;
  }
  return h;
};

/** Ein einzelner lesender Aufruf. Die Methode steht fest. */
function hole(pfad, { suche = {} } = {}) {
  const url = new URL(`https://${C.server}:${C.port}${pfad}`);
  for (const [k, v] of Object.entries(suche)) url.searchParams.set(k, String(v));

  return new Promise((resolve) => {
    const req = https.request(
      url,
      { method: 'GET', headers: kopf(), rejectUnauthorized: !C.allowSelfSigned, timeout: 20_000 },
      (res) => {
        res.setEncoding('utf8');
        let body = '';
        // Grosse Listen interessieren nicht — nach 64 KB ist alles gesagt.
        res.on('data', (c) => { if (body.length < 65_536) body += c; });
        res.on('end', () => {
          let daten = null;
          try { daten = body ? JSON.parse(body) : null; } catch { /* kein JSON */ }
          resolve({
            url: url.pathname + (url.search || ''),
            status: res.statusCode,
            typ: String(res.headers['content-type'] || '').split(';')[0],
            daten,
            text: daten ? null : body.slice(0, 200)
          });
        });
      }
    );
    req.on('timeout', () => { req.destroy(); resolve({ url: pfad, status: 0, fehler: 'Zeitüberschreitung' }); });
    req.on('error', (err) => resolve({ url: pfad, status: 0, fehler: err.message }));
    req.end();
  });
}

/** Was der Status bedeutet. Der Unterschied zwischen 404 und 401/403 ist der
 *  ganze Witz: das eine heisst "Pfad falsch", das andere "Pfad richtig". */
function deutung(a) {
  if (a.status === 0) return `nicht erreichbar — ${a.fehler}`;
  if (a.status === 200) return 'antwortet';
  if (a.status === 401) return 'Pfad existiert, Anmeldung abgelehnt';
  if (a.status === 403) return 'Pfad existiert, Recht fehlt';
  if (a.status === 404) return 'kein solcher Pfad (Bereich nicht installiert?)';
  if (a.status === 405) return 'Pfad existiert, aber nicht lesend';
  if (a.status === 501) return 'nicht lizenziert oder abgeschaltet';
  if (a.status >= 500) return `Serverfehler — ${a.text || ''}`.trim();
  return `HTTP ${a.status}`;
}

/** Feldnamen eines Listenergebnisses — ohne die Werte. */
function felder(daten) {
  if (!daten || typeof daten !== 'object') return null;
  const huelle = Object.keys(daten);
  const liste = Array.isArray(daten) ? daten : Array.isArray(daten.data) ? daten.data : null;
  const erstes = liste && liste.length && typeof liste[0] === 'object' ? Object.keys(liste[0]) : null;
  return { huelle, anzahl: liste ? liste.length : null, felder: erstes || (liste ? null : huelle) };
}

async function main() {
  if (!C.server) {
    console.error('BCONNECT_SERVER fehlt. Beispiel:\n  BCONNECT_SERVER=bms.firma.intern BCONNECT_API_KEY=… node tools/bconnect-entdecken.js');
    process.exit(1);
  }
  if (!C.apiKey && !(C.user && C.password)) {
    console.error('Keine Anmeldedaten: BCONNECT_API_KEY oder BCONNECT_USER + BCONNECT_PASSWORD.');
    process.exit(1);
  }

  const bericht = {
    zeitpunkt: new Date().toISOString(),
    server: `${C.server}:${C.port}`,
    anmeldung: C.user && C.password ? 'Basic' : 'X-API-KEY',
    bereiche: {}, kiosk: {}, beschreibung: {}, adBenutzer: null
  };

  console.log(`\nbConnect-Entdeckung auf https://${C.server}:${C.port}`);
  console.log(`Anmeldung: ${bericht.anmeldung}, nur lesende Aufrufe.\n`);

  console.log('— Bereiche ——————————————————————————————————');
  for (const [bereich, pfad] of BEREICHE) {
    const a = await hole(`/bconnect/${bereich}${pfad}`, { suche: { PageSize: 1 } });
    const f = a.status === 200 ? felder(a.daten) : null;
    bericht.bereiche[bereich] = { pfad: a.url, status: a.status, deutung: deutung(a), ...(f ? { form: f } : {}) };
    console.log(
      `${bereich.padEnd(23)} ${String(a.status).padStart(3)}  ${deutung(a)}` +
      (f?.felder ? `\n${' '.repeat(28)}Felder: ${f.felder.join(', ')}` : '') +
      (f?.huelle ? `\n${' '.repeat(28)}Huelle: ${f.huelle.join(', ')}` : '')
    );
  }

  console.log('\n— Was der Kiosk braucht ————————————————————————');
  for (const [bereich, pfad, zweck] of KIOSK) {
    const a = await hole(`/bconnect/${bereich}${pfad}`, { suche: { PageSize: 1 } });
    bericht.kiosk[`${bereich}${pfad}`] = { status: a.status, deutung: deutung(a), zweck };
    console.log(`${(bereich + pfad).padEnd(45)} ${String(a.status).padStart(3)}  ${deutung(a)}`);
    console.log(`${' '.repeat(45)}      ${zweck}`);
  }

  if (C.probeUser) {
    console.log(`\n— Anmeldename "${C.probeUser}" nachschlagen ——————————`);
    const a = await hole('/bconnect/activedirectory/v2.0/ADUsers', {
      suche: { SearchQuery: C.probeUser, PageSize: 5 }
    });
    const f = a.status === 200 ? felder(a.daten) : null;
    bericht.adBenutzer = { status: a.status, deutung: deutung(a), ...(f ? { form: f } : {}) };
    console.log(`Status ${a.status} — ${deutung(a)}`);
    if (f) {
      console.log(`Treffer: ${f.anzahl}`);
      // Hier liegt die Antwort auf die letzte offene Frage des Kiosk: welches
      // Feld traegt den Anmeldenamen, und welches die Kennung, die als
      // assignmentTargetId taugt.
      if (f.felder) console.log(`Felder eines AD-Benutzers: ${f.felder.join(', ')}`);
    }
  }

  console.log('\n— Maschinenlesbare Beschreibung ————————————————');
  let gefunden = false;
  for (const pfad of BESCHREIBUNGEN) {
    const a = await hole(pfad);
    bericht.beschreibung[pfad] = { status: a.status, typ: a.typ };
    if (a.status < 400) {
      gefunden = true;
      console.log(`${String(a.status).padStart(3)}  ${pfad}  (${a.typ || 'ohne Typ'})`);
    }
  }
  if (!gefunden) console.log('Keine der gaengigen Adressen liefert eine Beschreibung aus.');

  const antwortend = Object.entries(bericht.bereiche).filter(([, b]) => b.status === 200).map(([k]) => k);
  const abgelehnt = Object.entries(bericht.bereiche).filter(([, b]) => [401, 403].includes(b.status)).map(([k]) => k);
  console.log('\n— Fazit ————————————————————————————————————————');
  console.log(`Antwortende Bereiche (${antwortend.length}/${BEREICHE.length}): ${antwortend.join(', ') || '—'}`);
  if (abgelehnt.length) console.log(`Vorhanden, aber ohne Recht: ${abgelehnt.join(', ')}`);
  if (!antwortend.length) {
    console.log('Kein Bereich antwortet. Haeufigste Ursachen in dieser Reihenfolge:');
    console.log('  1. bConnect ist in der bMS nicht eingeschaltet.');
    console.log('  2. Der Schluessel ist abgelaufen oder gehoert zu einem anderen Server.');
    console.log('  3. Der Port ist nicht 443 (Modul-README: Port an den Hostnamen haengen).');
    console.log('  4. Eigenes Zertifikat — dann BCONNECT_ALLOW_SELF_SIGNED=true.');
  }

  if (C.report) {
    fs.writeFileSync(C.report, JSON.stringify(bericht, null, 2));
    console.log(`\nBericht: ${C.report}`);
  }
  console.log('');
}

main().catch((err) => { console.error('Fehlgeschlagen:', err.message); process.exit(1); });
