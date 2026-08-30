// Geräte-Token.
//
// Vorher gab es ein einziges gemeinsames Geheimnis für alle Agenten: Wer es von
// einem Rechner abgriff, konnte sich als jeder andere ausgeben und dessen
// Aufträge abholen. Jetzt bekommt jedes Gerät bei der Anmeldung ein eigenes
// Token, das nur für dieses Gerät gilt und einzeln gesperrt werden kann.
//
// Gespeichert wird nur der Hash. Wer die Datei liest, kann sich damit nicht
// ausgeben — dasselbe Prinzip wie bei Passwörtern.
//
// Das gemeinsame Geheimnis aus der `.env` bleibt, aber nur noch als
// Anmelde-Token für genau diesen einen Schritt.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'agents.json');

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    cache = {};
  }
  return cache;
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cache, null, 2), { mode: 0o600 });
}

function hash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Vergibt ein neues Token für ein Gerät. Das Klartext-Token wird genau hier
 * einmal zurückgegeben und danach nie wieder — gespeichert ist nur der Hash.
 *
 * Ein gesperrtes Gerät bekommt kein neues Token. Sonst hätte die Sperre keine
 * Wirkung: Wer das Anmelde-Token kennt, würde sich einfach neu anmelden.
 */
function enroll(deviceId) {
  const agents = load();
  if (agents[deviceId]?.revoked) {
    const err = new Error('Dieses Gerät ist gesperrt.');
    err.code = 'REVOKED';
    throw err;
  }

  const token = crypto.randomBytes(32).toString('hex');
  agents[deviceId] = {
    tokenHash: hash(token),
    enrolledAt: new Date().toISOString(),
    revoked: false
  };
  save();
  return token;
}

/** Prüft ein Token gegen genau ein Gerät. */
function verify(deviceId, token) {
  const agent = load()[deviceId];
  // `tokenHash` fehlt nach einem Entsperren: das Gerät ist bekannt, hat aber
  // noch kein gueltiges Token. Ohne diese Pruefung liefe der Vergleich unten
  // auf `undefined` und risse den Aufruf mit.
  if (!agent || agent.revoked || !agent.tokenHash || !token) return false;

  const expected = Buffer.from(agent.tokenHash, 'hex');
  const actual = Buffer.from(hash(token), 'hex');
  // Laufzeitkonstanter Vergleich: sonst verrät die Dauer, wie viele Zeichen stimmen.
  return crypto.timingSafeEqual(expected, actual);
}

/** Sperrt ein Gerät. Es kann sich danach weder melden noch neu anmelden. */
function revoke(deviceId) {
  const agents = load();
  if (!agents[deviceId]) return false;
  agents[deviceId].revoked = true;
  agents[deviceId].revokedAt = new Date().toISOString();
  save();
  return true;
}

/** Hebt eine Sperre auf. Das Gerät muss sich danach neu anmelden. */
function unrevoke(deviceId) {
  const agents = load();
  if (!agents[deviceId]) return false;
  delete agents[deviceId].tokenHash; // altes Token gilt nicht wieder
  agents[deviceId].revoked = false;
  delete agents[deviceId].revokedAt;
  save();
  return true;
}

/** Übersicht für die Administration — ohne Token, auch ohne Hash. */
function list() {
  return Object.entries(load()).map(([deviceId, a]) => ({
    deviceId,
    enrolledAt: a.enrolledAt || null,
    revoked: !!a.revoked,
    revokedAt: a.revokedAt || null,
    hasToken: !!a.tokenHash
  }));
}

/** Nur für Tests: Zwischenspeicher verwerfen. */
function reset() {
  cache = null;
}

module.exports = { enroll, verify, revoke, unrevoke, list, reset };
