// Entra-ID-Anmeldung (Microsoft 365).
//
// Aus bleibt aus: Ohne ENTRA_ENABLED=true verhält sich das Portal wie bisher
// und arbeitet mit dem Entwicklungs-Benutzer. Das ist Absicht — die Entwicklungs-
// umgebung soll ohne Mandanten weiterlaufen.
//
// An heißt an: Dann MUSS jede Portal-Anfrage ein gültiges Token tragen. Es gibt
// keinen Zwischenzustand, in dem ein ungültiges Token stillschweigend als
// Entwicklungs-Benutzer durchrutscht — genau so entstehen Auth-Lücken.

const crypto = require('crypto');
const { createRemoteJWKSet, jwtVerify } = require('jose');

const CONFIG = {
  enabled: process.env.ENTRA_ENABLED === 'true',
  tenantId: process.env.ENTRA_TENANT_ID || '',
  clientId: process.env.ENTRA_CLIENT_ID || '',
  // Der Scope, den das Frontend anfordert, z. B. api://<client-id>/access_as_user
  apiScope: process.env.ENTRA_API_SCOPE || ''
};

// Rollen, aufsteigend. 'admin' schließt 'it' ein, 'it' schließt 'user' ein.
// Liegt in roles.js, damit die Freigabelogik sie ohne diese Datei prüfen kann.
const { ROLES, rank } = require('./roles');

// Ohne Entra: Rolle über DEV_ROLE einstellbar, damit man alle drei Sichten
// durchspielen kann, ohne einen Mandanten zu haben.
const DEV_ROLE = ROLES.includes(process.env.DEV_ROLE) ? process.env.DEV_ROLE : 'admin';

// Kennung und Name sind ebenfalls einstellbar. Ohne das laesst sich das
// Vier-Augen-Prinzip ohne Entra gar nicht durchspielen: die Pruefung vergleicht
// `job.requestedBy` mit `user.id`, und bei einer festen Kennung ist der
// Freigebende immer dieselbe Person wie der Anfragende.
const DEV_USER_ID = process.env.DEV_USER_ID || 'dev@bfs.local';
const DEV_USER_NAME = process.env.DEV_USER_NAME || 'Entwicklungs-Benutzer';

const DEV_USER = {
  id: DEV_USER_ID,
  displayName: DEV_USER_NAME,
  email: DEV_USER_ID,
  department: 'IT',
  role: DEV_ROLE,
  authenticated: false
};

// --- Anmeldeweg ---------------------------------------------------------------
//
// 'entra'  Microsoft 365, Token wird geprueft. Der einzige Weg fuer den Echtbetrieb.
// 'local'  Konto und Passwort aus der portaleigenen Datenbank. Das Passwort
//          wird wirklich geprueft (scrypt), die Rolle kommt bei jeder Anfrage
//          frisch aus der Tabelle. Geprueft wird damit gegen das Portal, nicht
//          gegen das Verzeichnis des Unternehmens — fuer den Echtbetrieb bleibt
//          Entra der richtige Weg.
// 'simple' Der Nutzer tippt nur seinen Namen. Das ist KEINE Authentifizierung,
//          sondern eine Behauptung — niemand prueft sie. Nur fuer den Prototyp,
//          und im Portal wie im Audit-Log ausdruecklich als ungeprueft markiert.
// 'off'    Fester Entwicklungs-Benutzer wie bisher.
//
// Die Reihenfolge ist eine Rangfolge: Entra schlaegt alles, danach der echte
// Passwortweg, danach der behauptete Name. Zwei Wege gleichzeitig gibt es
// nicht — sonst waere der schwaechere eine offene Hintertuer.
const MODE = CONFIG.enabled
  ? 'entra'
  : process.env.LOCAL_LOGIN === 'true'
    ? 'local'
    : process.env.SIMPLE_LOGIN === 'true' ? 'simple' : 'off';

// Ohne gesetztes Geheimnis wird eines je Start erzeugt: dann gelten ausgestellte
// Sitzungen nur bis zum naechsten Neustart. Das ist fuer einen Prototyp richtig
// herum — lieber abgemeldet als ein Geheimnis, das jeder kennt.
const SIMPLE_SECRET = process.env.SIMPLE_LOGIN_SECRET || crypto.randomBytes(32).toString('hex');
const SIMPLE_TTL_MS = 12 * 60 * 60 * 1000;

// --- Lokale Konten ------------------------------------------------------------
//
// Eigenes Geheimnis, ersatzweise das des einfachen Wegs. Ohne gesetzten Wert
// wird eines je Start erzeugt: dann gelten Sitzungen nur bis zum naechsten
// Neustart. Fuer einen Prototyp richtig herum — lieber abgemeldet als ein
// Geheimnis, das im Repository steht.
const LOCAL_SECRET = process.env.LOCAL_LOGIN_SECRET || process.env.SIMPLE_LOGIN_SECRET
  || crypto.randomBytes(32).toString('hex');
const LOCAL_TTL_MS = Number(process.env.LOCAL_SESSION_HOURS || 12) * 60 * 60 * 1000;

const accounts = require('./accounts');
const users = require('./users');

const signLocalToken = (user) => accounts.signSession(user, LOCAL_SECRET, LOCAL_TTL_MS);
const verifyLocalToken = (token) => accounts.verifySession(token, LOCAL_SECRET);

const simpleAuth = require('./simple-auth');
const IDENTITY = simpleAuth.IDENTITY;
const signSimpleToken = (identity) => simpleAuth.signToken(identity, SIMPLE_SECRET, SIMPLE_TTL_MS);
const verifySimpleToken = (token) => simpleAuth.verifyToken(token, SIMPLE_SECRET);

// Wer welche Rolle bekommt, wenn Entra aktiv ist. Bevorzugt werden App-Rollen
// aus dem Token; die Namenslisten sind der Notnagel für Testmandanten, in denen
// noch keine App-Rollen angelegt sind.
const ADMIN_USERS = (process.env.ENTRA_ADMIN_USERS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const IT_USERS = (process.env.ENTRA_IT_USERS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

function roleFromName(name) {
  return simpleAuth.roleFromName(name, ADMIN_USERS, IT_USERS);
}

function roleFromClaims(claims) {
  const appRoles = (claims.roles || []).map((r) => String(r).toLowerCase());
  if (appRoles.includes('portal.admin') || appRoles.includes('admin')) return 'admin';
  if (appRoles.includes('portal.it') || appRoles.includes('it')) return 'it';

  return roleFromName(claims.preferred_username || claims.upn || '');
}

let jwks = null;
function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${CONFIG.tenantId}/discovery/v2.0/keys`)
    );
  }
  return jwks;
}

function configProblems() {
  const missing = [];
  if (!CONFIG.tenantId) missing.push('ENTRA_TENANT_ID');
  if (!CONFIG.clientId) missing.push('ENTRA_CLIENT_ID');
  return missing;
}

async function verifyToken(token) {
  const { payload } = await jwtVerify(token, getJwks(), {
    // v2.0-Token nennen als Aussteller die Mandanten-URL.
    issuer: `https://login.microsoftonline.com/${CONFIG.tenantId}/v2.0`,
    audience: CONFIG.clientId
  });
  return payload;
}

// Express-Middleware. Bei ausgeschalteter Anmeldung wird der Entwicklungs-
// Benutzer gesetzt, sonst wird das Token geprüft.
async function requireUser(req, res, next) {
  if (MODE === 'off') {
    req.user = { ...DEV_USER, authMode: 'off' };
    return next();
  }

  if (MODE === 'local') {
    const header = req.get('authorization') || '';
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Nicht angemeldet.' });
    }
    const claims = verifyLocalToken(header.slice(7));
    if (!claims) {
      return res.status(401).json({ error: 'Sitzung abgelaufen oder ungueltig.' });
    }

    // Rolle und Zustand kommen bei JEDER Anfrage aus der Datenbank, nicht aus
    // dem Token. Sonst behielte ein Konto seine Rolle bis zum Ablauf der
    // Sitzung — auch nachdem ein Administrator sie entzogen hat.
    let konto;
    try {
      konto = await users.findForSession(claims.id);
    } catch (err) {
      // Datenbank weg heisst nicht angemeldet. Ein stiller Durchlauf waere
      // hier die Luecke: dann waere die Datenbank die Rechtevergabe, und ihr
      // Ausfall waere eine Rechteerweiterung.
      return res.status(503).json({ error: `Kontodatenbank nicht erreichbar: ${err.message}` });
    }
    if (!konto || !konto.active) {
      return res.status(401).json({ error: 'Konto gesperrt oder gelöscht.' });
    }
    if (konto.tokenVersion !== claims.v) {
      return res.status(401).json({ error: 'Sitzung wurde beendet — bitte neu anmelden.' });
    }

    req.user = {
      id: konto.username,
      displayName: konto.displayName || konto.username,
      email: konto.username.includes('@') ? konto.username : '',
      department: '',
      role: konto.role,
      // Ein Passwort wurde wirklich geprueft — gegen die Tabelle des Portals,
      // nicht gegen das Unternehmensverzeichnis.
      authenticated: true,
      authMode: 'local',
      mustChangePassword: konto.mustChange,
      accountId: konto.id
    };
    return next();
  }

  if (MODE === 'simple') {
    const header = req.get('authorization') || '';
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Nicht angemeldet.' });
    }
    const claims = verifySimpleToken(header.slice(7));
    if (!claims) {
      return res.status(401).json({ error: 'Sitzung abgelaufen oder ungueltig.' });
    }
    req.user = {
      id: claims.id,
      displayName: claims.id,
      email: claims.id.includes('@') ? claims.id : '',
      department: '',
      role: roleFromName(claims.id),
      // Bleibt bewusst false: die Kennung wurde behauptet, nicht geprueft.
      authenticated: false,
      authMode: 'simple'
    };
    return next();
  }

  const missing = configProblems();
  if (missing.length) {
    // Lieber alles blockieren als halb offen laufen.
    return res.status(500).json({ error: `Entra-Anmeldung aktiv, aber unvollständig konfiguriert: ${missing.join(', ')}` });
  }

  const header = req.get('authorization') || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Nicht angemeldet.' });
  }

  try {
    const claims = await verifyToken(header.slice(7));
    req.user = {
      id: claims.preferred_username || claims.upn || claims.sub,
      displayName: claims.name || claims.preferred_username || 'Unbekannt',
      email: claims.preferred_username || claims.upn || '',
      department: '',
      role: roleFromClaims(claims),
      oid: claims.oid,
      groups: claims.groups || [],
      authenticated: true,
      authMode: 'entra'
    };
    next();
  } catch (err) {
    res.status(401).json({ error: `Token ungültig: ${err.message}` });
  }
}

// Was das Frontend zum Anmelden braucht. Enthält bewusst keine Geheimnisse —
// Mandanten- und Client-ID sind öffentliche Werte.
// Rollenprüfung. Immer NACH requireUser einhängen.
function requireRole(minimum) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet.' });
    if (rank(req.user.role) < rank(minimum)) {
      return res.status(403).json({
        error: `Dafür fehlt dir die Berechtigung (nötig: ${minimum}, du hast: ${req.user.role}).`
      });
    }
    next();
  };
}

function publicConfig() {
  return {
    authEnabled: CONFIG.enabled,
    mode: MODE,
    tenantId: CONFIG.tenantId,
    clientId: CONFIG.clientId,
    apiScope: CONFIG.apiScope,
    configProblems: CONFIG.enabled ? configProblems() : []
  };
}

module.exports = {
  requireUser, requireRole, publicConfig, CONFIG, DEV_USER, ROLES, rank,
  MODE, IDENTITY, signSimpleToken, verifySimpleToken, roleFromName,
  signLocalToken, verifyLocalToken, LOCAL_TTL_MS
};
