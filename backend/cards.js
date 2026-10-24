// Adaptive Cards für die Darstellung in Microsoft Teams.
//
// Copilot Studio gibt die Karten unverändert an Teams weiter; das Backend baut
// sie, damit Zahlen, Risikostufe und Freigabe-Kennung aus einer Quelle kommen
// und nicht im Agent noch einmal zusammengetextet werden.
//
// Freigaben laufen über `Action.Execute` mit den Verben `approve` und `deny`.
// Teams schickt beim Klick die `data` der Aktion zurück — dort steht die
// Auftrags-Kennung, nie der Befehl selbst.

const CARD_VERSION = '1.5';

const MARK = { ok: '✓', warning: '!', unknown: '?' };

function card(body, actions) {
  const value = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: CARD_VERSION,
    body
  };
  if (actions && actions.length) value.actions = actions;
  return value;
}

function text(value, extra = {}) {
  return { type: 'TextBlock', text: value, wrap: true, ...extra };
}

/** Ergebnis der Gerätediagnose: je Prüfung eine Zeile mit Zeichen und Satz. */
function diagnoseCard({ deviceId, results }) {
  const facts = Object.values(results || {}).map((r) => ({
    title: r.title,
    value: `${MARK[r.status] || MARK.unknown} ${r.label}`
  }));
  return card([
    text(`Diagnoseergebnis — ${deviceId || 'kein Gerät zugeordnet'}`, { weight: 'Bolder', size: 'Medium' }),
    { type: 'FactSet', facts }
  ]);
}

/**
 * Freigabekarte. `risk` ist die Stufe aus `actions.js`; sie wird hier in einen
 * Satz übersetzt, statt im Agent-Prompt zu landen.
 */
function approvalCard({ approvalId, deviceId, description, risk }) {
  return card(
    [
      text('Ihre Freigabe ist erforderlich', { weight: 'Bolder', color: 'Warning' }),
      text(description),
      {
        type: 'FactSet',
        facts: [
          { title: 'Zielgerät', value: deviceId || 'unbekannt' },
          { title: 'Risiko', value: risk === 'write' ? 'Schreibend — reversibel' : 'Lesend' },
          { title: 'Audit', value: 'Wird protokolliert' }
        ]
      }
    ],
    [
      { type: 'Action.Execute', title: '✓ Freigeben', verb: 'approve', style: 'positive', data: { approvalId } },
      { type: 'Action.Execute', title: '✗ Ablehnen', verb: 'deny', style: 'default', data: { approvalId } }
    ]
  );
}

/** Stand eines Auftrags, den der Bot nach der Freigabe abfragt. */
function statusCard({ jobId, status, summary }) {
  const headline = {
    done: '✓ Erledigt',
    error: '✗ Fehlgeschlagen',
    denied: 'Abgelehnt',
    awaiting_approval: 'Wartet auf Freigabe',
    queued: 'Eingereiht',
    dispatched: 'Läuft'
  }[status] || status;

  return card([
    text(headline, { weight: 'Bolder' }),
    text(summary || 'Noch kein Ergebnis.'),
    text(`Auftrag ${jobId}`, { isSubtle: true, size: 'Small' })
  ]);
}

/** Bestätigung einer Eskalation nach Jira. */
function ticketCard({ key, url, summary, reused }) {
  return card(
    [
      text(reused ? `Vorgang ${key} besteht bereits` : `Vorgang ${key} angelegt`, { weight: 'Bolder' }),
      text(summary || ''),
      text('Der 2nd-Level meldet sich.', { isSubtle: true, size: 'Small' })
    ],
    url ? [{ type: 'Action.OpenUrl', title: 'In Jira öffnen', url }] : []
  );
}

module.exports = { diagnoseCard, approvalCard, statusCard, ticketCard, CARD_VERSION };
