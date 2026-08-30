// Atlassian-Treiber: Confluence als Wissensdatenbank, Jira als Ticketsystem.
//
// Beide Produkte hängen bei Atlassian Cloud unter derselben Adresse und
// derselben Anmeldung (HTTP Basic mit E-Mail + API-Token), deshalb ein
// gemeinsamer Treiber statt zwei fast gleicher Dateien.
//
// Zwei Dinge kommen NIE aus dem Modell oder aus einer Anfrage: das
// Jira-Projekt und der Vorgangstyp. Beide stehen in den Einstellungen
// (Administrationsseite oder `.env`). Sonst könnte ein Gespräch Tickets in
// beliebigen Projekten anlegen.
//
// Was aus dem Gespräch kommt — Titel und Beschreibung — läuft vorher durch
// `redact()`. Ein Ticket ist für viele lesbar und bleibt jahrelang stehen;
// ein Passwort, das ein Nutzer im Chat genannt hat, gehört da nicht hinein.

const settings = require('../settings');

// Werte kommen aus der Administrationsseite, ersatzweise aus der `.env`.
// Bewusst bei jedem Zugriff frisch gelesen: sonst müsste der Container nach
// jeder Änderung neu starten.
function cfg() {
  const s = settings.group('atlassian');
  return {
    baseUrl: (s.baseUrl || '').replace(/\/+$/, ''),
    email: s.email || '',
    apiToken: s.apiToken || '',
    projectKey: s.projectKey || '',
    issueType: s.issueType || 'Aufgabe',
    // Leer = alle Bereiche. Sonst kommagetrennte Confluence-Bereichsschlüssel.
    spaceKeys: (s.spaceKeys || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
  };
}

const MAX_SUMMARY = 240;
const MAX_DESCRIPTION = 8000;
const ISSUE_KEY = /^[A-Z][A-Z0-9_]{1,20}-[0-9]{1,10}$/;

// Grob, aber besser als nichts: was nach Zugangsdaten aussieht, wird ersetzt,
// bevor es das Haus verlässt. Bewusst nicht abschaltbar.
const SECRETS = [
  /(?<=\b(?:passwor[dt]|kennwort|passwort|token|secret|api[- ]?key)\b\s*[:=]?\s*)\S+/gi,
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g
];

function isConfigured() {
  const c = cfg();
  return Boolean(c.baseUrl && c.email && c.apiToken);
}

function jiraReady() {
  return isConfigured() && Boolean(cfg().projectKey);
}

function redact(text) {
  let out = String(text ?? '');
  for (const pattern of SECRETS) out = out.replace(pattern, '[entfernt]');
  return out;
}

function authHeader() {
  const c = cfg();
  const raw = `${c.email}:${c.apiToken}`;
  return `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`;
}

async function call(path, { method = 'GET', body } = {}) {
  if (!isConfigured()) throw new Error('Atlassian ist nicht konfiguriert.');
  const res = await fetch(`${cfg().baseUrl}${path}`, {
    method,
    headers: {
      Authorization: authHeader(),
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* Atlassian antwortet bei manchen Fehlern mit HTML */
  }
  if (!res.ok) {
    const detail =
      json?.errorMessages?.join('; ') ||
      Object.values(json?.errors || {}).join('; ') ||
      json?.message ||
      `HTTP ${res.status}`;
    throw new Error(`Atlassian: ${detail}`);
  }
  return json;
}

// --- Confluence ------------------------------------------------------------

// CQL kennt Anführungszeichen: ein unmaskiertes " im Suchtext würde die
// Abfrage aufbrechen. Backslash und Anführungszeichen werden escaped.
function cqlQuote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Volltextsuche in Confluence. Liefert Titel, Auszug und Link.
 * Nur lesend — der Treiber schreibt nie in die Wissensdatenbank.
 */
async function searchKnowledge(query, limit = 5, { withBody = false, bodyCount = 2 } = {}) {
  const text = String(query || '').trim();
  if (text.length < 3) throw new Error('Suchbegriff ist zu kurz.');
  const size = Math.min(Math.max(Number(limit) || 5, 1), 10);

  const spaceKeys = cfg().spaceKeys;
  const parts = [`type = "page"`, `text ~ ${cqlQuote(text)}`];
  if (spaceKeys.length) {
    parts.push(`space in (${spaceKeys.map(cqlQuote).join(', ')})`);
  }
  const cql = parts.join(' AND ');

  const json = await call(
    `/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=${size}`
  );
  const hits = (json?.results || []).map((r) => ({
    id: r.content?.id || null,
    title: r.title || r.content?.title || 'ohne Titel',
    // Confluence markiert Treffer mit @@@hl@@@ — für den Chat unbrauchbar.
    excerpt: String(r.excerpt || '').replace(/@@@(end)?hl@@@/g, '').trim(),
    url: r.url ? `${cfg().baseUrl}/wiki${r.url}` : null,
    lastModified: r.lastModified || null
  }));

  // Die Suche liefert nur Auszüge. Ohne Seitentext kann das Modell auf die
  // richtige Seite zeigen, aber nicht daraus antworten — deshalb für die
  // vordersten Treffer den Inhalt nachladen.
  if (withBody) {
    for (const hit of hits.slice(0, Math.min(bodyCount, hits.length))) {
      if (!hit.id) continue;
      try {
        hit.body = await fetchPageText(hit.id);
      } catch {
        // Eine fehlende Seite darf die ganze Suche nicht scheitern lassen.
        hit.body = null;
      }
    }
  }
  return hits;
}

const PAGE_ID = /^[0-9]{1,20}$/;
const MAX_BODY = 6000;

/** Holt den Text einer Confluence-Seite. Storage-Format ist XHTML — für das
 *  Modell reicht der Fließtext, Markup kostet nur Kontext. */
async function fetchPageText(pageId) {
  if (!PAGE_ID.test(String(pageId))) throw new Error('Ungültige Seiten-ID.');
  const json = await call(`/wiki/api/v2/pages/${pageId}?body-format=storage`);
  const raw = json?.body?.storage?.value || '';
  return htmlToText(raw).slice(0, MAX_BODY);
}

function htmlToText(html) {
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

// --- Jira ------------------------------------------------------------------

// Jira v3 nimmt keine Klartext-Beschreibung mehr, sondern das Atlassian
// Document Format. Wir bauen es aus Absätzen selbst, statt roh
// durchzureichen — so kann kein Gespräch fremde ADF-Knoten einschleusen.
function toAdf(plainText) {
  const paragraphs = String(plainText || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    type: 'doc',
    version: 1,
    content: (paragraphs.length ? paragraphs : ['(keine Beschreibung)']).map((p) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: p }]
    }))
  };
}

/**
 * Legt ein Ticket an, wenn die KI nicht weiterkommt.
 * `context` wird an die Beschreibung angehängt: Gerät, Nutzer, letzte Schritte.
 */
async function createTicket({ summary, description, context = {}, labels = [] }) {
  if (!jiraReady()) throw new Error('Jira ist nicht konfiguriert (JIRA_PROJECT_KEY fehlt).');
  const title = redact(String(summary || '').trim()).slice(0, MAX_SUMMARY);
  if (title.length < 5) throw new Error('Titel ist zu kurz.');

  const lines = [redact(String(description || '').trim())];
  const facts = Object.entries(context).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (facts.length) {
    lines.push(facts.map(([k, v]) => `${k}: ${redact(String(v))}`).join('\n'));
  }
  lines.push('Angelegt vom BFS-Self-Service-Portal, weil die KI nicht weiterkam.');
  const body = lines.join('\n\n').slice(0, MAX_DESCRIPTION);

  const c = cfg();
  const json = await call('/rest/api/3/issue', {
    method: 'POST',
    body: {
      fields: {
        project: { key: c.projectKey },
        issuetype: { name: c.issueType },
        summary: title,
        description: toAdf(body),
        labels: ['bfs-portal', ...labels.filter((l) => /^[A-Za-z0-9_-]{1,50}$/.test(l))]
      }
    }
  });

  return {
    key: json.key,
    id: json.id,
    url: `${c.baseUrl}/browse/${json.key}`
  };
}

async function getTicket(key) {
  if (!ISSUE_KEY.test(key || '')) throw new Error('Ungültiger Ticket-Schlüssel.');
  const json = await call(
    `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status,created,assignee`
  );
  return {
    key: json.key,
    summary: json.fields?.summary || '',
    status: json.fields?.status?.name || 'unbekannt',
    assignee: json.fields?.assignee?.displayName || null,
    created: json.fields?.created || null,
    url: `${cfg().baseUrl}/browse/${json.key}`
  };
}

module.exports = {
  name: 'atlassian',
  isConfigured,
  jiraReady,
  searchKnowledge,
  fetchPageText,
  htmlToText,
  createTicket,
  getTicket,
  redact,
  toAdf,
  cqlQuote,
  cfg,
  ISSUE_KEY
};
