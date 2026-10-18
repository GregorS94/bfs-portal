// Lokale Konten — die reine Rechnung, ohne Datenbank.
//
// Getrennt von users.js aus demselben Grund wie simple-auth.js von auth.js:
// users.js braucht einen Postgres-Pool und ist ohne ihn nicht ladbar. Alles,
// was hier steht, laesst sich mit blossem `node` pruefen — und genau diese
// Funktionen entscheiden, ob ein Passwort gilt und wer wen aendern darf.
//
// Zur Einordnung: Anders als der Weg 'simple' prueft dieser Weg wirklich ein
// Geheimnis. Er authentifiziert also — aber gegen eine portaleigene Tabelle,
// nicht gegen das Verzeichnis des Unternehmens. Fuer den Prototyp ist das der
// Punkt; fuer den Echtbetrieb bleibt Entra der richtige Weg.

const crypto = require('crypto');

// Anmeldename: Kontoname oder UPN, wie beim einfachen Weg. Der Wert landet in
// Ticket, Audit-Log und Jira-Beschreibung, deshalb bewusst eng.
const USERNAME = /^[A-Za-z0-9._%+-]{2,64}(@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24})?$/;

const ROLES = ['user', 'it', 'admin'];

// scrypt statt bcrypt: steckt in node selbst. Eine native Abhaengigkeit waere
// auf dem Raspberry Pi (arm64) jedes Mal ein Bauschritt mehr.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
// 128 * N * r sind 16 MiB; die Vorgabe von node liegt bei 32 MiB. Ohne eigenen
// Wert waere der Aufruf knapp an der Grenze und wuerde bei einer Erhoehung von
// N stillschweigend werfen.
const MAXMEM = 64 * 1024 * 1024;

// Kurze Kennwoerter sind erlaubt, weil der Prototyp bewusst mit `1234`
// ausgeliefert wird (Entscheidung Gregor, 2026-10-18). Die Oberflaeche sagt
// dafuer an jeder Stelle, dass das kein Betriebszustand ist.
const MIN_LENGTH = 4;
const MAX_LENGTH = 200;

// Was ausgeliefert wird und deshalb als bekannt gelten muss.
const DEFAULT_PASSWORDS = new Set(['admin', '1234', 'passwort', 'password', 'test']);

/** Erzeugt `scrypt$N$r$p$salt$hash`. Alle Parameter stehen mit im Wert, damit
 *  sich N spaeter erhoehen laesst, ohne alte Hashes unlesbar zu machen. */
function hashPassword(password) {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: MAXMEM
  });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

/** Prueft ein Passwort gegen einen gespeicherten Wert. Gibt nie etwas anderes
 *  als true/false zurueck — ein Fehler im Format ist ein falsches Passwort. */
function verifyPassword(password, stored) {
  const teile = String(stored || '').split('$');
  if (teile.length !== 6 || teile[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = teile;
  if (typeof password !== 'string' || !password.length) return false;

  let errechnet;
  try {
    const erwartet = Buffer.from(hash, 'base64url');
    // Die Laenge wird gegen SCRYPT.keylen geprueft und nicht einfach
    // uebernommen. Grund: der letzte Schritt von scrypt ist PBKDF2, und dessen
    // Ausgabe ist praefixstabil — ein auf 29 Byte gekuerzter gespeicherter Hash
    // wuerde mit keylen 29 nachgerechnet und wieder passen. Ein abgeschnittener
    // Wert in der Tabelle wuerde das Passwort also weiter annehmen, im
    // Extremfall bei einem Byte mit Wahrscheinlichkeit 1/256. Gefunden in
    // tools/accounts-test.js, 2026-10-18.
    if (erwartet.length !== SCRYPT.keylen) return false;
    errechnet = crypto.scryptSync(password, Buffer.from(salt, 'base64url'), erwartet.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: MAXMEM
    });
    // Laengenvergleich zuerst: timingSafeEqual wirft bei ungleicher Laenge.
    if (errechnet.length !== erwartet.length) return false;
    return crypto.timingSafeEqual(errechnet, erwartet);
  } catch {
    return false;
  }
}

/** Was an einem Passwort nicht stimmt — oder null. */
function passwordProblem(password) {
  if (typeof password !== 'string') return 'Passwort fehlt.';
  if (password.length < MIN_LENGTH) return `Das Passwort braucht mindestens ${MIN_LENGTH} Zeichen.`;
  if (password.length > MAX_LENGTH) return `Das Passwort darf höchstens ${MAX_LENGTH} Zeichen haben.`;
  return null;
}

/** Was am Anmeldenamen nicht stimmt — oder null. */
function usernameProblem(name) {
  if (typeof name !== 'string' || !name.trim()) return 'Anmeldename fehlt.';
  if (!USERNAME.test(name.trim())) return 'Anmeldename enthält unerlaubte Zeichen.';
  return null;
}

/** Namen werden klein gespeichert und klein verglichen. Sonst sind `Admin`
 *  und `admin` zwei Konten, und eines davon hat niemand angelegt. */
const normalizeUsername = (name) => String(name || '').trim().toLowerCase();

/** Gilt das Passwort als ausgeliefert und damit als oeffentlich bekannt? */
const isDefaultPassword = (password) => DEFAULT_PASSWORDS.has(String(password || '').toLowerCase());

/**
 * Darf `actor` das an `target` aendern? Gibt den Grund zurueck oder null.
 *
 * Reine Rechnung mit Absicht: die drei Faelle, in denen sich ein Portal selbst
 * aussperrt, sind hier einzeln pruefbar, ohne eine Datenbank aufzusetzen.
 *
 * @param {{id: number, username: string}} actor      wer aendert
 * @param {{id: number, username: string, role: string, active: boolean}} target wen
 * @param {{role?: string, active?: boolean, remove?: boolean}} patch  was
 * @param {number} aktiveAdmins  wie viele aktive Administratoren es gerade gibt
 */
function changeProblem(actor, target, patch, aktiveAdmins) {
  if (!target) return 'Konto unbekannt.';
  if (patch.role && !ROLES.includes(patch.role)) return `Unbekannte Rolle: ${patch.role}`;

  const eigenes = actor && Number(actor.id) === Number(target.id);
  if (eigenes && patch.remove) return 'Das eigene Konto kann man nicht löschen.';
  if (eigenes && patch.active === false) return 'Das eigene Konto kann man nicht sperren.';
  if (eigenes && patch.role && patch.role !== 'admin' && target.role === 'admin') {
    return 'Die eigene Administratorrolle kann man nicht abgeben — sonst bleibt niemand übrig, der sie zurückgibt.';
  }

  // Der letzte aktive Administrator ist unantastbar. Ohne ihn kommt niemand
  // mehr in die Benutzerverwaltung, und das Portal ist nur noch per Datenbank
  // zu retten.
  const verliertAdmin = target.role === 'admin' && target.active &&
    (patch.remove === true || patch.active === false || (patch.role && patch.role !== 'admin'));
  if (verliertAdmin && aktiveAdmins <= 1) {
    return 'Das ist der letzte aktive Administrator — ohne ihn kommt niemand mehr in die Verwaltung.';
  }
  return null;
}


// --- Sitzungstoken ------------------------------------------------------------
//
// Dieselbe Bauform wie beim einfachen Weg (HMAC ueber einen base64url-Rumpf),
// aber mit einem Feld mehr: `v` traegt die Token-Fassung des Kontos. Beim
// Pruefen wird sie gegen die Datenbank gehalten. Dadurch endet eine Sitzung
// sofort, wenn das Passwort geaendert oder das Konto gesperrt wird — ohne dass
// das Portal eine Liste gueltiger Token fuehren muesste.

function signSession({ username, tokenVersion }, secret, ttlMs) {
  const body = Buffer.from(JSON.stringify({
    id: normalizeUsername(username),
    v: Number(tokenVersion) || 1,
    exp: Date.now() + ttlMs
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifySession(token, secret, now = Date.now()) {
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
    if (typeof claims.id !== 'string' || !USERNAME.test(claims.id)) return null;
    if (typeof claims.v !== 'number' || !Number.isInteger(claims.v) || claims.v < 1) return null;
    if (typeof claims.exp !== 'number' || claims.exp < now) return null;
    return claims;
  } catch {
    return null;
  }
}

module.exports = {
  USERNAME, ROLES, MIN_LENGTH, MAX_LENGTH,
  hashPassword, verifyPassword, passwordProblem, usernameProblem,
  normalizeUsername, isDefaultPassword, changeProblem,
  signSession, verifySession
};
