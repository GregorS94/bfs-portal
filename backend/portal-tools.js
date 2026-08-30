// Werkzeuge, die nicht am Gerät hängen.
//
// Die Chat-Schleife reichte bisher nur gerätebezogene Werkzeuge durch. Nachsehen
// in der Wissensdatenbank und Eskalieren gehören aber zum Gespräch, nicht zum
// Rechner — sie funktionieren auch, wenn gar kein Gerät zugeordnet ist.
//
// Beide laufen ohne Freigabe: Nachschlagen ist lesend, und eine Eskalation, die
// erst genehmigt werden muss, ist keine Eskalation. Stattdessen gibt es pro
// Gespräch nur ein Ticket, und jede Erstellung steht im Audit-Log.

const atlassian = require('./drivers/atlassian');

// sessionId -> Ticket. Im RAM: nach einem Neustart kann dasselbe Gespräch ein
// zweites Ticket erzeugen. Bewusst in Kauf genommen, wie bei Aufträgen/Geräten.
const ticketsBySession = new Map();

const TOOLS = {
  search_knowledge_base: {
    available: () => atlassian.isConfigured(),
    definition: {
      name: 'search_knowledge_base',
      description:
        'Durchsucht die interne Wissensdatenbank (Confluence) nach Anleitungen und ' +
        'Hausregeln. Nutze das, bevor du aus allgemeinem Wissen antwortest — die ' +
        'internen Seiten schlagen jede allgemeine Anleitung.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Suchbegriff, mindestens drei Zeichen' }
        },
        required: ['query'],
        additionalProperties: false
      }
    }
  },
  create_ticket: {
    available: () => atlassian.jiraReady(),
    definition: {
      name: 'create_ticket',
      description:
        'Legt ein Ticket für den 2nd-Level an, wenn du nicht weiterkommst — etwa bei ' +
        'Hardwaretausch, fremden Konten oder wenn die Diagnose nichts ergeben hat. ' +
        'Sage dem Nutzer vorher in einem Satz, dass du übergibst. Pro Gespräch wird ' +
        'nur ein Ticket angelegt; ein zweiter Aufruf liefert dasselbe zurück.',
      input_schema: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'Kurzer Titel, der das Problem benennt (mindestens fünf Zeichen)'
          },
          description: {
            type: 'string',
            description:
              'Was der Nutzer meldet, was du geprüft hast und was dabei herauskam. ' +
              'Nenne niemals Passwörter.'
          }
        },
        required: ['summary', 'description'],
        additionalProperties: false
      }
    }
  }
};

function has(name) {
  return Object.prototype.hasOwnProperty.call(TOOLS, name);
}

/** Nur anbieten, was auch konfiguriert ist — sonst schlägt das Modell Wege vor,
 *  die ins Leere laufen. */
function definitions() {
  return Object.values(TOOLS)
    .filter((t) => t.available())
    .map((t) => t.definition);
}

/**
 * Legt genau ein Ticket je Gespräch an. Wird von der Chat-Schleife und vom
 * REST-Endpunkt gleichermaßen benutzt, damit beide sich denselben Zähler teilen.
 */
async function createTicketOnce({ summary, description, sessionId, context = {} }) {
  const known = sessionId ? ticketsBySession.get(sessionId) : null;
  if (known) return { ticket: known, reused: true };
  const ticket = await atlassian.createTicket({ summary, description, context });
  if (sessionId) ticketsBySession.set(sessionId, ticket);
  return { ticket, reused: false };
}

/**
 * Führt ein geräteloses Werkzeug aus.
 * Gibt `{ ok, content, event }` zurück — `event` geht als SSE an das Frontend.
 */
async function execute(name, input = {}, ctx = {}) {
  if (name === 'search_knowledge_base') {
    // Für die vordersten Treffer den Seitentext mitladen — sonst kann das
    // Modell nur auf die Seite zeigen, statt daraus zu antworten.
    const hits = await atlassian.searchKnowledge(input.query, 5, { withBody: true, bodyCount: 2 });
    if (!hits.length) {
      return { ok: true, content: 'Kein Treffer in der Wissensdatenbank.', event: { hits: 0 } };
    }
    const text = hits
      .map((h, i) => {
        const head = `${i + 1}. ${h.title}\n${h.url || ''}`;
        return h.body ? `${head}\n${h.body}` : `${head}\n${h.excerpt}`;
      })
      .join('\n\n---\n\n');
    return { ok: true, content: text.slice(0, 8000), event: { hits: hits.length } };
  }

  if (name === 'create_ticket') {
    const { ticket, reused } = await createTicketOnce({
      summary: input.summary,
      description: input.description,
      sessionId: ctx.sessionId,
      context: {
        Melder: ctx.user || 'unbekannt',
        Gerät: ctx.device || 'nicht angegeben',
        Gespräch: ctx.sessionId || 'nicht angegeben'
      }
    });
    return {
      ok: true,
      content: reused
        ? `Für dieses Gespräch besteht bereits Ticket ${ticket.key}. Nenne dem Nutzer diese Nummer.`
        : `Ticket ${ticket.key} angelegt. Nenne dem Nutzer die Nummer und dass sich der 2nd-Level meldet.`,
      event: { key: ticket.key, url: ticket.url, reused },
      ticket,
      reused
    };
  }

  throw new Error(`Unbekanntes Portal-Werkzeug: ${name}`);
}

module.exports = { has, definitions, execute, createTicketOnce, ticketsBySession, TOOLS };
