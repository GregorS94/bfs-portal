// Nachbau der drei Atlassian-Aufrufe, die der Treiber braucht — genug, um
// ihn ohne echte Cloud-Instanz zu prüfen. Wie tools/bconnect-mock.js.
//
// Start: node tools/atlassian-mock.js [port]
const http = require('http');

const PORT = Number(process.argv[2] || 4600);

const BODIES = {
  '101':
    '<h2>Drucker FLOOR2-HP verbinden</h2><p>Einstellungen &gt; Drucker &amp; Scanner &gt; ' +
    'Ger&auml;t hinzuf&uuml;gen.</p><ul><li>Warteschlange: <b>FLOOR2-HP</b></li>' +
    '<li>Server: print01.bfs.local</li></ul><script>egal()</script>',
  '102': '<p>VPN-Antrag &uuml;ber das Formular im Intranet.</p>',
  '201': '<p>Urlaub wird in Personio beantragt.</p>'
};

const PAGES = [
  {
    id: '101',
    title: 'Drucker einrichten (Windows)',
    excerpt: 'So verbindest du dich mit @@@hl@@@Drucker@@@endhl@@@ FLOOR2-HP',
    url: '/spaces/IT/pages/101/Drucker-einrichten',
    lastModified: '2026-07-01T09:00:00Z',
    space: 'IT'
  },
  {
    id: '102',
    title: 'VPN-Zugang beantragen',
    excerpt: 'Antrag über das Formular, Freigabe durch den Vorgesetzten',
    url: '/spaces/IT/pages/102/VPN',
    lastModified: '2026-06-11T09:00:00Z',
    space: 'IT'
  },
  {
    id: '201',
    title: 'Urlaubsantrag',
    excerpt: 'Personalthema, kein IT-Inhalt',
    url: '/spaces/HR/pages/201/Urlaub',
    lastModified: '2026-05-02T09:00:00Z',
    space: 'HR'
  }
];

// Was der Mock zuletzt gesehen hat — die Tests prüfen damit CQL und Felder.
const seen = { cql: [], issues: [], auth: [], pages: [] };
let counter = 0;

function send(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  seen.auth.push(req.headers.authorization || null);

  if (!String(req.headers.authorization || '').startsWith('Basic ')) {
    return send(res, 401, { message: 'keine Anmeldung' });
  }

  if (req.method === 'GET' && url.pathname === '/wiki/rest/api/search') {
    const cql = url.searchParams.get('cql') || '';
    seen.cql.push(cql);
    const limit = Number(url.searchParams.get('limit') || 5);
    const term = (/text ~ "((?:[^"\\]|\\.)*)"/.exec(cql) || [])[1] || '';
    const spaces = (/space in \(([^)]*)\)/.exec(cql) || [])[1];
    const allowed = spaces
      ? spaces.split(',').map((s) => s.trim().replace(/^"|"$/g, ''))
      : null;

    const needle = term.replace(/\\(.)/g, '$1').toLowerCase();
    const results = PAGES.filter(
      (p) =>
        (!allowed || allowed.includes(p.space)) &&
        (p.title.toLowerCase().includes(needle) || p.excerpt.toLowerCase().includes(needle))
    ).slice(0, limit);
    return send(res, 200, { results: results.map((p) => ({ ...p, content: { id: p.id, title: p.title } })) });
  }

  if (req.method === 'POST' && url.pathname === '/rest/api/3/issue') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        return send(res, 400, { errorMessages: ['kein gültiges JSON'] });
      }
      const f = parsed.fields || {};
      if (!f.project?.key) return send(res, 400, { errors: { project: 'fehlt' } });
      if (!f.summary) return send(res, 400, { errors: { summary: 'fehlt' } });
      // Jira v3 nimmt nur ADF, kein Klartext — das soll der Test merken.
      if (typeof f.description !== 'object' || f.description?.type !== 'doc') {
        return send(res, 400, { errors: { description: 'erwartet ADF (type: doc)' } });
      }
      seen.issues.push(f);
      counter += 1;
      const key = `${f.project.key}-${100 + counter}`;
      return send(res, 201, { id: String(9000 + counter), key, self: `/rest/api/3/issue/${key}` });
    });
    return;
  }

  const pageMatch = /^\/wiki\/api\/v2\/pages\/([^/?]+)$/.exec(url.pathname);
  if (req.method === 'GET' && pageMatch) {
    const id = decodeURIComponent(pageMatch[1]);
    if (!BODIES[id]) return send(res, 404, { message: 'Seite unbekannt' });
    seen.pages.push(id);
    return send(res, 200, { id, body: { storage: { value: BODIES[id], representation: 'storage' } } });
  }

  const issueMatch = /^\/rest\/api\/3\/issue\/([^/?]+)$/.exec(url.pathname);
  if (req.method === 'GET' && issueMatch) {
    const key = decodeURIComponent(issueMatch[1]);
    const created = seen.issues.length ? seen.issues[0] : null;
    return send(res, 200, {
      key,
      fields: {
        summary: created?.summary || 'Testvorgang',
        status: { name: 'Offen' },
        created: '2026-08-29T12:00:00Z',
        assignee: null
      }
    });
  }

  send(res, 404, { message: 'unbekannter Pfad: ' + url.pathname });
});

module.exports = { server, PORT, PAGES, seen };

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () =>
    console.log(`Atlassian-Attrappe auf http://127.0.0.1:${PORT}`)
  );
}
