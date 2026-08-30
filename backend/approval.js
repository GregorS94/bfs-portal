// Wer darf einen Auftrag freigeben oder ablehnen?
//
// Eigenes Modul, weil das die sicherheitsrelevanteste Entscheidung im Portal
// ist: Sie steht zwischen "das Modell schlägt etwas vor" und "auf einem
// fremden Rechner passiert etwas". Als Block in index.js wäre sie nicht ohne
// laufenden Server prüfbar.

const { ACTIONS } = require('./actions');

/**
 * Liefert den Ablehnungsgrund oder null, wenn die Person entscheiden darf.
 *
 * Grundregel: Freigeben darf, wer den Auftrag selbst ausgelöst hat — das ist
 * die Einwilligung für das eigene Gerät — oder IT und Admin für beliebige
 * Aufträge.
 *
 * Ausnahme: Aktionen mit `fourEyes` betreffen fremde Konten. Dort ist die
 * Zustimmung des Anfragenden keine Kontrolle, sondern nur ein zweiter Klick
 * derselben Person.
 */
function decisionProblem(user, job, rank) {
  const action = ACTIONS[job.action];

  if (action?.fourEyes) {
    if (rank(user.role) < rank('it')) {
      return 'Diese Aktion darf nur der IT-Support freigeben.';
    }
    if (job.requestedBy === user.id) {
      return 'Vier-Augen-Prinzip: diesen Auftrag muss eine andere Person freigeben.';
    }
    return null;
  }

  if (job.requestedBy === user.id || rank(user.role) >= rank('it')) {
    return null;
  }
  return 'Dieser Auftrag gehört dir nicht.';
}

module.exports = { decisionProblem };
