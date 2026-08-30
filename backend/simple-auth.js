// Der einfache Anmeldeweg, als eigenes Modul.
//
// Getrennt von auth.js aus demselben Grund wie approval.js: auth.js zieht die
// Entra-Bibliothek herein und ist damit ohne installierte Abhaengigkeiten nicht
// ladbar. Diese Funktionen sind reine Rechnung und lassen sich mit blossem node
// pruefen — und genau sie entscheiden, wer sich als wer ausgeben kann.
//
// Wichtig zur Einordnung: Dieser Weg *authentifiziert* niemanden. Er nimmt eine
// behauptete Kennung entgegen und macht sie faelschungssicher gegen Veraenderung
// durch den Browser. Wer die Kennung eines anderen eintippt, ist dieser andere.
// Deshalb nur im Prototyp, sichtbar gekennzeichnet, und im Audit-Log als
// ungeprueft vermerkt.

const crypto = require('crypto');

// Anmeldename: UPN oder blosser Kontoname. Bewusst eng — der Wert landet in
// Ticket, Audit-Log und Jira-Beschreibung.
const IDENTITY = /^[A-Za-z0-9._%+-]{1,64}(@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24})?$/;

function signToken(identity, secret, ttlMs) {
  const body = Buffer.from(JSON.stringify({ id: identity, exp: Date.now() + ttlMs })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token, secret, now = Date.now()) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  // Laengenvergleich zuerst: timingSafeEqual wirft bei ungleicher Laenge.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (typeof claims.id !== 'string' || !IDENTITY.test(claims.id)) return null;
    if (typeof claims.exp !== 'number' || claims.exp < now) return null;
    return claims;
  } catch {
    return null;
  }
}

// Rollen kommen aus denselben Namenslisten wie bei Entra, damit es nicht zwei
// Quellen der Wahrheit gibt.
function roleFromName(name, adminUsers = [], itUsers = []) {
  const lower = String(name || '').toLowerCase();
  if (adminUsers.includes(lower)) return 'admin';
  if (itUsers.includes(lower)) return 'it';
  // Standard ist die kleinste Rolle. Wer mehr darf, muss ausdrücklich benannt sein.
  return 'user';
}

module.exports = { IDENTITY, signToken, verifyToken, roleFromName };
