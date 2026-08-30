// Rollenordnung.
//
// Eigenes Modul, damit die Rangfolge geprüft werden kann, ohne die
// Anmeldung mitsamt ihren Abhängigkeiten zu laden. Sie entscheidet mit
// darüber, wer Aufträge freigeben darf.

// Aufsteigend: 'admin' schließt 'it' ein, 'it' schließt 'user' ein.
const ROLES = ['user', 'it', 'admin'];

/** Rang einer Rolle; unbekannte Rollen gelten als die schwächste. */
const rank = (role) => Math.max(0, ROLES.indexOf(role));

module.exports = { ROLES, rank };
