// Einstellungen, die zur Laufzeit über die Administrationsseite gesetzt werden.
//
// Vorrang: was hier gespeichert ist, schlägt die `.env`. Die `.env` bleibt der
// Weg für automatisierte Installationen; die Oberfläche ist der Weg für einen
// Menschen, der gerade ein API-Token in der Hand hat.
//
// Geheimnisse verlassen dieses Modul nie in Richtung Browser: `redactAll()`
// liefert nur, ob etwas hinterlegt ist. Die Datei liegt im selben Volume wie
// das Audit-Log und wird mit 0600 geschrieben.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'settings.json');

// Welche Felder es gibt, woher der Vorgabewert kommt, und ob es ein Geheimnis
// ist. Nur was hier steht, kann über die API gesetzt werden.
const SCHEMA = {
  atlassian: {
    baseUrl: { env: 'ATLASSIAN_BASE_URL', label: 'Adresse der Instanz' },
    email: { env: 'ATLASSIAN_EMAIL', label: 'E-Mail des technischen Kontos' },
    apiToken: { env: 'ATLASSIAN_API_TOKEN', label: 'API-Token', secret: true },
    projectKey: { env: 'JIRA_PROJECT_KEY', label: 'Jira-Projektschlüssel' },
    issueType: { env: 'JIRA_ISSUE_TYPE', label: 'Vorgangstyp', fallback: 'Aufgabe' },
    spaceKeys: { env: 'CONFLUENCE_SPACE_KEYS', label: 'Confluence-Bereiche (kommagetrennt)' }
  },
  entra: {
    tenantId: { env: 'ENTRA_TENANT_ID', label: 'Mandanten-ID' },
    clientId: { env: 'ENTRA_GRAPH_CLIENT_ID', label: 'Anwendungs-ID' },
    clientSecret: { env: 'ENTRA_GRAPH_CLIENT_SECRET', label: 'Geheimnis', secret: true },
    authBase: { env: 'ENTRA_AUTH_BASE', label: 'Anmelde-Adresse (nur für Tests)' },
    graphBase: { env: 'ENTRA_GRAPH_BASE', label: 'Graph-Adresse (nur für Tests)' }
  }
};

let stored = null; // { atlassian: {...}, entra: {...} }

function load() {
  if (stored) return stored;
  try {
    stored = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    stored = {};
  }
  return stored;
}

/** Der wirksame Wert eines Feldes: Gespeichertes vor `.env` vor Vorgabe. */
function value(group, key) {
  const field = SCHEMA[group]?.[key];
  if (!field) return '';
  const saved = load()[group]?.[key];
  if (saved !== undefined && saved !== null && saved !== '') return String(saved);
  return process.env[field.env] || field.fallback || '';
}

/** Alle wirksamen Werte einer Gruppe. */
function group(name) {
  const out = {};
  for (const key of Object.keys(SCHEMA[name] || {})) out[key] = value(name, key);
  return out;
}

/**
 * Nimmt Änderungen entgegen. Ein leerer String heißt „nicht anfassen" —
 * sonst würde ein Speichern der Seite jedes Geheimnis löschen, weil das
 * Formular es nie im Klartext kennt. Zum Löschen dient `null`.
 */
function update(name, patch) {
  if (!SCHEMA[name]) throw new Error(`Unbekannter Bereich: ${name}`);
  const data = load();
  const current = { ...(data[name] || {}) };

  for (const [key, raw] of Object.entries(patch || {})) {
    if (!SCHEMA[name][key]) continue; // stillschweigend ignorieren, nicht raten
    if (raw === null) {
      delete current[key];
      continue;
    }
    if (typeof raw !== 'string' || raw === '') continue;
    current[key] = raw.trim();
  }

  data[name] = current;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(FILE, 0o600); // bei bestehender Datei greift `mode` nicht
  } catch {
    /* auf manchen Dateisystemen nicht erlaubt — kein Grund abzubrechen */
  }
  stored = data;
  return redact(name);
}

/** Was der Browser sehen darf: Werte ohne Geheimnisse. */
function redact(name) {
  const out = { fields: {}, secrets: {} };
  for (const [key, field] of Object.entries(SCHEMA[name] || {})) {
    if (field.secret) {
      out.secrets[key] = { set: Boolean(value(name, key)), label: field.label };
    } else {
      out.fields[key] = { value: value(name, key), label: field.label };
    }
  }
  return out;
}

function redactAll() {
  const out = {};
  for (const name of Object.keys(SCHEMA)) out[name] = redact(name);
  return out;
}

/** Nur für Tests: erzwingt das nächste Lesen von der Platte. */
function reload() {
  stored = null;
}

module.exports = { SCHEMA, value, group, update, redact, redactAll, reload, FILE };
