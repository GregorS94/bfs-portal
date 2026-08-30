// Entra-ID-Treiber: Vorabprüfung, ob ein Benutzer die Selbstbedienung
// (SSPR) überhaupt nutzen kann.
//
// Wichtig, weil es oft anders erwartet wird: **SSPR selbst hat keine API.**
// Microsoft stellt keinen Endpunkt bereit, über den man den Rücksetz-Dialog
// eines Benutzers auslösen oder dessen Code prüfen könnte — dieser Ablauf
// existiert nur als Microsofts eigene Weboberfläche. Ein eigenes Portal kann
// also nur zweierlei: vorher nachsehen, ob SSPR für diesen Benutzer greift,
// und ihn danach dorthin schicken.
//
// Der Bericht `userRegistrationDetails` ist GA und lässt sich mit einem
// Anwendungs-Token lesen (`AuditLog.Read.All`). Das eigentliche Zurücksetzen
// über Graph (`authenticationMethod: resetPassword`) geht dagegen NUR
// delegiert — mit angemeldetem Administrator, nicht mit Dienst-Token. Es ist
// hier bewusst nicht implementiert.

const settings = require('../settings');

const DEFAULT_AUTH_BASE = 'https://login.microsoftonline.com';
const DEFAULT_GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const SSPR_PORTAL = 'https://passwordreset.microsoftonline.com/';

// UPN oder Anmeldename. Bewusst eng: der Wert geht in einen OData-$filter,
// und ein Apostroph darin würde den Filter aufbrechen.
const UPN = /^[A-Za-z0-9._-]{1,64}@[A-Za-z0-9.-]{1,192}$/;

let cachedToken = null; // { value, expiresAt }

// Werte aus der Administrationsseite, ersatzweise aus der `.env`.
function config() {
  const s = settings.group('entra');
  return {
    tenantId: s.tenantId || '',
    clientId: s.clientId || '',
    clientSecret: s.clientSecret || '',
    authBase: s.authBase || DEFAULT_AUTH_BASE,
    graphBase: s.graphBase || DEFAULT_GRAPH_BASE
  };
}

function isConfigured() {
  const c = config();
  return Boolean(c.tenantId && c.clientId && c.clientSecret);
}

async function getToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const c = config();
  if (!isConfigured()) throw new Error('Entra-Graph ist nicht konfiguriert.');

  const body = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });
  const res = await fetch(`${c.authBase}/${encodeURIComponent(c.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) throw new Error(`Token-Abruf fehlgeschlagen (HTTP ${res.status}).`);
  const json = await res.json();
  if (!json.access_token) throw new Error('Token-Antwort ohne access_token.');
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000
  };
  return cachedToken.value;
}

// Nur für Tests: erzwingt den nächsten Token-Abruf.
function resetTokenCache() {
  cachedToken = null;
}

/**
 * Liest den SSPR-Zustand eines Benutzers.
 * Liefert `{ found: false }`, wenn es den Benutzer nicht gibt — der Bericht
 * enthält auch deaktivierte Konten nicht.
 */
async function getSsprStatus(upn) {
  if (!UPN.test(upn || '')) throw new Error('Ungültiger UPN.');
  const token = await getToken();
  const filter = `userPrincipalName eq '${upn}'`;
  const url =
    `${config().graphBase}/reports/authenticationMethods/userRegistrationDetails` +
    `?$filter=${encodeURIComponent(filter)}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Graph-Abfrage fehlgeschlagen (HTTP ${res.status}).`);
  const json = await res.json();
  const entry = (json.value || [])[0];
  if (!entry) return { found: false, upn };

  return {
    found: true,
    upn: entry.userPrincipalName,
    displayName: entry.userDisplayName,
    isAdmin: Boolean(entry.isAdmin),
    isSsprEnabled: Boolean(entry.isSsprEnabled),
    isSsprRegistered: Boolean(entry.isSsprRegistered),
    isSsprCapable: Boolean(entry.isSsprCapable),
    methodsRegistered: entry.methodsRegistered || [],
    lastUpdated: entry.lastUpdatedDateTime || null
  };
}

/**
 * Übersetzt den Zustand in die Entscheidung, die am Telefon zählt:
 * kann der Anrufer sich selbst helfen, oder muss die IT ran?
 */
function triage(status) {
  if (!status.found) {
    return {
      selfService: false,
      reason: 'unbekannt',
      advice:
        'Kein Eintrag im Anmeldeberichte-Datensatz. Konto existiert nicht, ist deaktiviert ' +
        'oder rein lokal — manuell im AD prüfen.'
    };
  }
  if (status.isSsprCapable) {
    return {
      selfService: true,
      reason: 'bereit',
      advice: `Kann selbst zurücksetzen über ${SSPR_PORTAL}`,
      url: SSPR_PORTAL
    };
  }
  if (!status.isSsprEnabled) {
    return {
      selfService: false,
      reason: 'nicht freigeschaltet',
      advice:
        'Richtlinie erlaubt diesem Benutzer keine Selbstbedienung. Zurücksetzen durch die IT.'
    };
  }
  return {
    selfService: false,
    reason: 'nicht registriert',
    advice:
      'Freigeschaltet, aber nicht genügend Verfahren hinterlegt — der Benutzer kommt ' +
      'durch die Selbstbedienung nicht durch. Jetzt zurücksetzen und danach zur ' +
      'Registrierung schicken.'
  };
}

module.exports = {
  isConfigured,
  getSsprStatus,
  triage,
  resetTokenCache,
  SSPR_PORTAL,
  UPN
};
