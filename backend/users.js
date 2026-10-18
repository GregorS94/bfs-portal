// Konten in der Datenbank — die Schicht zwischen SQL und den Routen.
//
// Zwei Regeln gelten hier durchgehend:
//
// 1. Der Passworthash verlaesst dieses Modul nur ueber `findForLogin()`. Alle
//    anderen Funktionen geben eine Sicht ohne Hash zurueck, damit er nicht
//    versehentlich in einer JSON-Antwort landet.
// 2. Wer darf was aendern, steht in accounts.changeProblem() — nicht hier.
//    Dadurch ist die Regel ohne Datenbank pruefbar.

const db = require('./db');
const accounts = require('./accounts');

/** Sicht fuer die Oberflaeche. Ohne Hash, mit Zeiten als ISO-Text. */
function view(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.display_name || row.username,
    role: row.role,
    active: row.active,
    mustChange: row.must_change,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    lastLoginAt: row.last_login_at?.toISOString?.() || row.last_login_at || null
  };
}

async function list() {
  // Administratoren zuerst, dann IT, dann Mitarbeiter. `ORDER BY role` waere
  // alphabetisch und damit genau verkehrt herum.
  const { rows } = await db.query(
    `SELECT * FROM portal_users
      ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'it' THEN 1 ELSE 2 END, username ASC`
  );
  return rows.map(view);
}

async function findById(id) {
  const { rows } = await db.query('SELECT * FROM portal_users WHERE id = $1', [Number(id) || 0]);
  return view(rows[0]);
}

/** Die einzige Funktion, die den Hash und die Token-Fassung mitgibt. */
async function findForLogin(username) {
  const { rows } = await db.query(
    'SELECT * FROM portal_users WHERE username = $1',
    [accounts.normalizeUsername(username)]
  );
  const row = rows[0];
  if (!row) return null;
  return { ...view(row), passwordHash: row.password_hash, tokenVersion: row.token_version };
}

/** Wer hinter einem Token steckt. Gibt auch die Token-Fassung mit, damit der
 *  Aufrufer eine abgelaufene Sitzung erkennt. */
async function findForSession(username) {
  const { rows } = await db.query(
    'SELECT * FROM portal_users WHERE username = $1',
    [accounts.normalizeUsername(username)]
  );
  const row = rows[0];
  return row ? { ...view(row), tokenVersion: row.token_version } : null;
}

async function countActiveAdmins() {
  const { rows } = await db.query(
    "SELECT count(*)::int AS n FROM portal_users WHERE role = 'admin' AND active = TRUE"
  );
  return rows[0].n;
}

async function create({ username, password, role = 'user', displayName = '' }) {
  const problem = accounts.usernameProblem(username) || accounts.passwordProblem(password);
  if (problem) throw new Error(problem);
  if (!accounts.ROLES.includes(role)) throw new Error(`Unbekannte Rolle: ${role}`);

  const name = accounts.normalizeUsername(username);
  try {
    const { rows } = await db.query(
      `INSERT INTO portal_users (username, display_name, password_hash, role)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, String(displayName || '').trim(), accounts.hashPassword(password), role]
    );
    return view(rows[0]);
  } catch (err) {
    // 23505 = unique_violation. Eigene Meldung, sonst steht der SQL-Text in
    // der Oberflaeche.
    if (err.code === '23505') throw new Error(`Das Konto „${name}" gibt es schon.`);
    throw err;
  }
}

/** Rolle, Name oder Sperre aendern. Eine Sperre macht laufende Sitzungen
 *  sofort ungueltig — deshalb zaehlt sie die Token-Fassung hoch. */
async function update(id, { role, active, displayName }) {
  const felder = [];
  const werte = [];
  const setze = (sql, wert) => { werte.push(wert); felder.push(`${sql} = $${werte.length}`); };

  if (role !== undefined) {
    if (!accounts.ROLES.includes(role)) throw new Error(`Unbekannte Rolle: ${role}`);
    setze('role', role);
  }
  if (active !== undefined) setze('active', Boolean(active));
  if (displayName !== undefined) setze('display_name', String(displayName).trim());
  if (!felder.length) return findById(id);

  felder.push('updated_at = now()');
  if (active === false) felder.push('token_version = token_version + 1');

  werte.push(Number(id) || 0);
  const { rows } = await db.query(
    `UPDATE portal_users SET ${felder.join(', ')} WHERE id = $${werte.length} RETURNING *`,
    werte
  );
  return view(rows[0]);
}

/** Neues Passwort setzen. Zaehlt die Token-Fassung hoch: wer das alte Passwort
 *  kannte, ist damit auch aus laufenden Sitzungen heraus. */
async function setPassword(id, password, { mustChange = false } = {}) {
  const problem = accounts.passwordProblem(password);
  if (problem) throw new Error(problem);
  const { rows } = await db.query(
    `UPDATE portal_users
        SET password_hash = $1, must_change = $2, token_version = token_version + 1, updated_at = now()
      WHERE id = $3 RETURNING *`,
    [accounts.hashPassword(password), Boolean(mustChange), Number(id) || 0]
  );
  return view(rows[0]);
}

async function remove(id) {
  const { rowCount } = await db.query('DELETE FROM portal_users WHERE id = $1', [Number(id) || 0]);
  return rowCount > 0;
}

async function touchLogin(id) {
  await db.query('UPDATE portal_users SET last_login_at = now() WHERE id = $1', [Number(id) || 0]);
}

module.exports = {
  list, findById, findForLogin, findForSession, countActiveAdmins,
  create, update, setPassword, remove, touchLogin
};
