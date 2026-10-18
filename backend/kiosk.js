// Software-Anforderungen fuer den baramundi Kiosk.
//
// Der Ablauf hat drei Beteiligte und jeder macht genau einen Schritt:
//
//   1. Der Mitarbeiter fordert im Portal eine Software an.
//   2. Die IT gibt frei. Das Portal ruft dabei `POST /v2.0/KioskReleases` in
//      der bMS auf — mehr nicht.
//   3. Der Mitarbeiter installiert sie selbst im Kiosk, wann es ihm passt.
//
// Das Portal fuehrt also nichts auf einem fremden Rechner aus. Es erlaubt, und
// die Ausfuehrung bleibt beim Anwender. Warum das kein Zufall ist, steht in
// `docs/BARAMUNDI.md`.
//
// Das Zuweisungsziel (`assignmentTargetId`) traegt die IT bei der Freigabe ein.
// Es waere bequemer, es aus dem Anmeldenamen abzuleiten — dazu muesste das
// Portal aber das AD-Objekt des Nutzers in der bMS nachschlagen, und die Pfade
// der dafuer noetigen Leseendpunkte liegen uns nicht woertlich vor. Geraten
// wird hier nichts.

const db = require('./db');
const bconnect = require('./drivers/bconnect');

/** Sicht fuer die Oberflaeche. */
function view(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    username: row.username,
    jobDefinitionId: row.job_definition_id,
    jobName: row.job_name,
    assignmentTargetId: row.assignment_target_id || '',
    state: row.state,
    releaseId: row.release_id || null,
    note: row.note || '',
    requestedAt: row.requested_at?.toISOString?.() || row.requested_at,
    decidedAt: row.decided_at?.toISOString?.() || row.decided_at || null,
    decidedBy: row.decided_by || null
  };
}

/** Der Katalog, wie der Mitarbeiter ihn sieht: freigebbare Jobs plus der
 *  eigene Stand. Faellt die bMS aus, bleibt der Katalog leer — mit Grund,
 *  statt stillschweigend. */
async function catalog(username) {
  let jobs = [];
  let problem = null;
  try {
    jobs = await bconnect.listKioskJobs();
  } catch (err) {
    problem = err.message;
  }
  return {
    ready: bconnect.kioskReady(),
    kioskUrl: bconnect.kioskWebUrl(),
    jobs,
    problem,
    requests: await listForUser(username)
  };
}

async function listForUser(username) {
  const { rows } = await db.query(
    'SELECT * FROM kiosk_requests WHERE username = $1 ORDER BY requested_at DESC LIMIT 50',
    [String(username || '')]
  );
  return rows.map(view);
}

async function listAll({ onlyOpen = false, limit = 100 } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM kiosk_requests ${onlyOpen ? "WHERE state = 'requested'" : ''}
      ORDER BY requested_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map(view);
}

async function byId(id) {
  const { rows } = await db.query('SELECT * FROM kiosk_requests WHERE id = $1', [Number(id) || 0]);
  return view(rows[0]);
}

/**
 * Anfordern. Der Job muss im Katalog stehen — die Kennung aus dem Browser wird
 * nicht uebernommen, sondern gegen den Katalog aufgeloest. Sonst koennte
 * jemand eine beliebige Jobdefinition anfordern und die IT gaebe sie im
 * Vertrauen auf den angezeigten Namen frei.
 */
async function request({ username, jobDefinitionId, note = '' }) {
  const jobs = await bconnect.listKioskJobs();
  const job = jobs.find((j) => String(j.id) === String(jobDefinitionId));
  if (!job) throw new Error('Diese Software steht nicht im Kiosk-Katalog.');

  const offen = await db.query(
    `SELECT id FROM kiosk_requests
      WHERE username = $1 AND job_definition_id = $2 AND state IN ('requested','released')`,
    [username, String(job.id)]
  );
  if (offen.rowCount) throw new Error(`„${job.name}" ist für dich schon angefordert oder freigegeben.`);

  const { rows } = await db.query(
    `INSERT INTO kiosk_requests (username, job_definition_id, job_name, note)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [username, String(job.id), job.name, String(note || '').slice(0, 500)]
  );
  return view(rows[0]);
}

/**
 * Freigeben. Erst die bMS, dann die eigene Tabelle — in dieser Reihenfolge:
 * schlaegt der Aufruf fehl, bleibt die Anforderung offen. Umgekehrt stuende in
 * der Tabelle „freigegeben", ohne dass im Kiosk etwas erschienen waere.
 */
async function release(id, { assignmentTargetId, decidedBy }) {
  const anforderung = await byId(id);
  if (!anforderung) throw new Error('Anforderung unbekannt.');
  if (anforderung.state !== 'requested') throw new Error(`Anforderung ist schon ${anforderung.state}.`);
  if (!assignmentTargetId) throw new Error('Das Zuweisungsziel (assignmentTargetId) fehlt.');

  const freigabe = await bconnect.createKioskRelease({
    assignmentTargetId,
    jobDefinitionId: anforderung.jobDefinitionId
  });

  const { rows } = await db.query(
    `UPDATE kiosk_requests
        SET state = 'released', release_id = $1, assignment_target_id = $2,
            decided_at = now(), decided_by = $3
      WHERE id = $4 RETURNING *`,
    [freigabe.id || null, String(assignmentTargetId), String(decidedBy || ''), Number(id)]
  );
  return view(rows[0]);
}

async function deny(id, { decidedBy, note = '' }) {
  const anforderung = await byId(id);
  if (!anforderung) throw new Error('Anforderung unbekannt.');
  if (anforderung.state !== 'requested') throw new Error(`Anforderung ist schon ${anforderung.state}.`);

  const { rows } = await db.query(
    `UPDATE kiosk_requests
        SET state = 'denied', decided_at = now(), decided_by = $1,
            note = CASE WHEN $2 = '' THEN note ELSE $2 END
      WHERE id = $3 RETURNING *`,
    [String(decidedBy || ''), String(note || '').slice(0, 500), Number(id)]
  );
  return view(rows[0]);
}

/** Freigabe zuruecknehmen. Ohne Kennung der Freigabe ginge das nur im bMC. */
async function withdraw(id, { decidedBy }) {
  const anforderung = await byId(id);
  if (!anforderung) throw new Error('Anforderung unbekannt.');
  if (anforderung.state !== 'released') throw new Error('Nur freigegebene Anforderungen lassen sich zurückziehen.');
  if (!anforderung.releaseId) throw new Error('Zu dieser Freigabe ist keine Kennung gespeichert — nur im bMC zurücknehmbar.');

  await bconnect.deleteKioskRelease(anforderung.releaseId);
  const { rows } = await db.query(
    `UPDATE kiosk_requests
        SET state = 'withdrawn', decided_at = now(), decided_by = $1
      WHERE id = $2 RETURNING *`,
    [String(decidedBy || ''), Number(id)]
  );
  return view(rows[0]);
}

module.exports = { catalog, listForUser, listAll, byId, request, release, deny, withdraw };
