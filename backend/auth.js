// Entra-ID-Anmeldung (Microsoft 365).
//
// Aus bleibt aus: Ohne ENTRA_ENABLED=true verhält sich das Portal wie bisher
// und arbeitet mit dem Entwicklungs-Benutzer. Das ist Absicht — die Entwicklungs-
// umgebung soll ohne Mandanten weiterlaufen.
//
// An heißt an: Dann MUSS jede Portal-Anfrage ein gültiges Token tragen. Es gibt
// keinen Zwischenzustand, in dem ein ungültiges Token stillschweigend als
// Entwicklungs-Benutzer durchrutscht — genau so entstehen Auth-Lücken.

const { createRemoteJWKSet, jwtVerify } = require('jose');

const CONFIG = {
  enabled: process.env.ENTRA_ENABLED === 'true',
  tenantId: process.env.ENTRA_TENANT_ID || '',
  clientId: process.env.ENTRA_CLIENT_ID || '',
  // Der Scope, den das Frontend anfordert, z. B. api://<client-id>/access_as_user
  apiScope: process.env.ENTRA_API_SCOPE || ''
};

// Rollen, aufsteigend. 'admin' schließt 'it' ein, 'it' schließt 'user' ein.
const ROLES = ['user', 'it', 'admin'];
const rank = (role) => Math.max(0, ROLES.indexOf(role));

// Ohne Entra: Rolle über DEV_ROLE einstellbar, damit man alle drei Sichten
// durchspielen kann, ohne einen Mandanten zu haben.
const DEV_ROLE = ROLES.includes(process.env.DEV_ROLE) ? process.env.DEV_ROLE : 'admin';

const DEV_USER = {
  id: 'dev@bfs.local',
  displayName: 'Entwicklungs-Benutzer',
  email: 'dev@bfs.local',
  department: 'IT',
  role: DEV_ROLE,
  authenticated: false
};

// Wer welche Rolle bekommt, wenn Entra aktiv ist. Bevorzugt werden App-Rollen
// aus dem Token; die Namenslisten sind der Notnagel für Testmandanten, in denen
// noch keine App-Rollen angelegt sind.
const ADMIN_USERS = (process.env.ENTRA_ADMIN_USERS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const IT_USERS = (process.env.ENTRA_IT_USERS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

function roleFromClaims(claims) {
  const appRoles = (claims.roles || []).map((r) => String(r).toLowerCase());
  if (appRoles.includes('portal.admin') || appRoles.includes('admin')) return 'admin';
  if (appRoles.includes('portal.it') || appRoles.includes('it')) return 'it';

  const name = String(claims.preferred_username || claims.upn || '').toLowerCase();
  if (ADMIN_USERS.includes(name)) return 'admin';
  if (IT_USERS.includes(name)) return 'it';

  // Standard ist die kleinste Rolle. Wer mehr darf, muss ausdrücklich benannt sein.
  return 'user';
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
  if (!CONFIG.enabled) {
    req.user = DEV_USER;
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
      authenticated: true
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
    tenantId: CONFIG.tenantId,
    clientId: CONFIG.clientId,
    apiScope: CONFIG.apiScope,
    configProblems: CONFIG.enabled ? configProblems() : []
  };
}

module.exports = { requireUser, requireRole, publicConfig, CONFIG, DEV_USER, ROLES, rank };
