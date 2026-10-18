// Postgres — die erste dauerhafte Ablage des Portals.
//
// Bisher lag alles entweder im RAM (Geraete, Auftraege) oder in Dateien
// (Audit-Log, Einstellungen). Konten brauchen mehr: sie muessen einen Neustart
// ueberleben, in der Oberflaeche aenderbar sein und gleichzeitig von mehreren
// Anfragen gelesen werden. Dafuer ist eine Datenbank das richtige Werkzeug.
//
// Warum Postgres und nicht Supabase: Supabase ist Postgres plus ein Dutzend
// Dienste (Auth, Storage, Realtime, Studio), die das Portal nicht benutzt. Auf
// einem Raspberry Pi 5 waere das viel RAM fuer nichts. Das Datenmodell bleibt
// reines SQL — ein spaeterer Umzug auf Supabase oder einen Unternehmensserver
// ist ein Verbindungsstring, kein Umbau.
//
// Ohne Konfiguration bleibt die Datenbank aus. Das Portal laeuft dann wie
// vorher weiter; nur der Anmeldeweg 'local' ist dann nicht verfuegbar, und
// zwar sichtbar (500 beim Anmelden) statt stillschweigend.

const { Pool } = require('pg');
const accounts = require('./accounts');

const CONFIG = {
  url: process.env.DATABASE_URL || '',
  host: process.env.DB_HOST || '',
  port: Number(process.env.DB_PORT || 5432),
  name: process.env.DB_NAME || 'bfs_portal',
  user: process.env.DB_USER || 'portal',
  password: process.env.DB_PASSWORD || ''
};

// Die Startkonten. Bewusst schwach und bewusst in der Konfiguration sichtbar:
// Gregor hat `admin/admin` und `user/1234` ausdruecklich so bestellt
// (2026-10-18). Beide Konten werden mit `must_change` angelegt, damit die
// Oberflaeche unmissverstaendlich dazu auffordert, sie zu aendern.
const SEEDS = [
  {
    username: process.env.LOCAL_ADMIN_USER || 'admin',
    password: process.env.LOCAL_ADMIN_PASSWORD || 'admin',
    role: 'admin',
    displayName: 'Administrator'
  },
  {
    username: process.env.LOCAL_USER_USER || 'user',
    password: process.env.LOCAL_USER_PASSWORD || '1234',
    role: 'user',
    displayName: 'Testnutzer'
  }
];

const isConfigured = () => Boolean(CONFIG.url || CONFIG.host);

let pool = null;
let bereit = false;

function getPool() {
  if (!isConfigured()) throw new Error('Keine Datenbank konfiguriert (DATABASE_URL oder DB_HOST).');
  if (!pool) {
    pool = CONFIG.url
      ? new Pool({ connectionString: CONFIG.url, max: 5, connectionTimeoutMillis: 5000 })
      : new Pool({
        host: CONFIG.host, port: CONFIG.port, database: CONFIG.name,
        user: CONFIG.user, password: CONFIG.password, max: 5, connectionTimeoutMillis: 5000
      });
    // Ohne diesen Zuhoerer beendet ein Verbindungsabbruch im Leerlauf den
    // ganzen Prozess — pg wirft den Fehler sonst auf dem Pool.
    pool.on('error', (err) => console.warn('Postgres (Leerlauf):', err.message));
  }
  return pool;
}

function query(sql, params = []) {
  return getPool().query(sql, params);
}

// Das Schema steht hier und nicht in einer Migrationsbibliothek: zwei Tabellen
// rechtfertigen kein weiteres Werkzeug. `IF NOT EXISTS` macht den Aufruf bei
// jedem Start unschaedlich.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS portal_users (
     id             BIGSERIAL PRIMARY KEY,
     username       TEXT        NOT NULL UNIQUE,
     display_name   TEXT        NOT NULL DEFAULT '',
     password_hash  TEXT        NOT NULL,
     role           TEXT        NOT NULL CHECK (role IN ('user','it','admin')),
     active         BOOLEAN     NOT NULL DEFAULT TRUE,
     must_change    BOOLEAN     NOT NULL DEFAULT FALSE,
     -- Zaehlt bei jeder Passwortaenderung und bei jeder Sperre hoch. Das Token
     -- traegt den Wert mit; so wird eine laufende Sitzung sofort ungueltig,
     -- statt bis zum Ablauf weiterzugelten.
     token_version  INTEGER     NOT NULL DEFAULT 1,
     created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
     last_login_at  TIMESTAMPTZ
   )`,
  `CREATE TABLE IF NOT EXISTS kiosk_requests (
     id                   BIGSERIAL PRIMARY KEY,
     username             TEXT        NOT NULL,
     job_definition_id    TEXT        NOT NULL,
     job_name             TEXT        NOT NULL DEFAULT '',
     assignment_target_id TEXT        NOT NULL DEFAULT '',
     -- requested → released | denied | withdrawn
     state                TEXT        NOT NULL DEFAULT 'requested'
                                      CHECK (state IN ('requested','released','denied','withdrawn')),
     release_id           TEXT,
     note                 TEXT        NOT NULL DEFAULT '',
     requested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
     decided_at           TIMESTAMPTZ,
     decided_by           TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS kiosk_requests_user ON kiosk_requests (username, state)`
];

/**
 * Legt das Schema an und saet die Startkonten, falls die Tabelle leer ist.
 * Leer heisst leer: ein geloeschtes `admin` kommt nicht zurueck.
 */
async function init() {
  for (const sql of SCHEMA) await query(sql);

  const { rows } = await query('SELECT count(*)::int AS n FROM portal_users');
  if (rows[0].n === 0) {
    for (const seed of SEEDS) {
      await query(
        `INSERT INTO portal_users (username, display_name, password_hash, role, must_change)
         VALUES ($1, $2, $3, $4, TRUE)`,
        [accounts.normalizeUsername(seed.username), seed.displayName,
          accounts.hashPassword(seed.password), seed.role]
      );
    }
    console.log(`Datenbank: ${SEEDS.length} Startkonten angelegt (${SEEDS.map((s) => s.username).join(', ')}).`);
  }
  bereit = true;
  return true;
}

/** Fuer die Dienstanzeige im Administrationsbereich. */
async function health() {
  if (!isConfigured()) return { status: 'off', detail: 'Keine Datenbank konfiguriert.' };
  try {
    const { rows } = await query('SELECT count(*)::int AS n FROM portal_users');
    return { status: 'ok', detail: `Postgres antwortet, ${rows[0].n} Konten.` };
  } catch (err) {
    return { status: 'error', detail: err.message };
  }
}

const isReady = () => bereit;

async function close() {
  if (pool) await pool.end();
  pool = null;
  bereit = false;
}

module.exports = { CONFIG, SEEDS, isConfigured, isReady, init, query, health, close };
