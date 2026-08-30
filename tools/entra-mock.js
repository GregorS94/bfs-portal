// Nachbau der beiden Graph-Aufrufe, die der Entra-Treiber braucht — genug,
// um den Treiber ohne Mandanten zu prüfen. Wie tools/bconnect-mock.js.
//
// Start: node tools/entra-mock.js [port]
const http = require('http');

const PORT = Number(process.argv[2] || 4599);

const USERS = {
  // Freigeschaltet UND registriert -> kann sich selbst helfen.
  'a.bereit@bfs.de': {
    userPrincipalName: 'a.bereit@bfs.de',
    userDisplayName: 'Anna Bereit',
    isAdmin: false,
    isSsprEnabled: true,
    isSsprRegistered: true,
    isSsprCapable: true,
    methodsRegistered: ['mobilePhone', 'microsoftAuthenticatorPush'],
    lastUpdatedDateTime: '2026-08-20T08:00:00Z'
  },
  // Freigeschaltet, aber ohne hinterlegte Verfahren -> läuft in die Sackgasse.
  'b.unregistriert@bfs.de': {
    userPrincipalName: 'b.unregistriert@bfs.de',
    userDisplayName: 'Bernd Unregistriert',
    isAdmin: false,
    isSsprEnabled: true,
    isSsprRegistered: false,
    isSsprCapable: false,
    methodsRegistered: [],
    lastUpdatedDateTime: '2026-08-20T08:00:00Z'
  },
  // Per Richtlinie ausgeschlossen.
  'c.gesperrt@bfs.de': {
    userPrincipalName: 'c.gesperrt@bfs.de',
    userDisplayName: 'Clara Gesperrt',
    isAdmin: true,
    isSsprEnabled: false,
    isSsprRegistered: true,
    isSsprCapable: false,
    methodsRegistered: ['mobilePhone'],
    lastUpdatedDateTime: '2026-08-20T08:00:00Z'
  }
};

// Was der Mock zuletzt gesehen hat — der Test prüft damit den echten $filter.
const seen = { filters: [] };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (req.method === 'POST' && url.pathname.endsWith('/oauth2/v2.0/token')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const form = new URLSearchParams(body);
      if (form.get('grant_type') !== 'client_credentials' || !form.get('client_secret')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'invalid_request' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'mock-token', expires_in: 3600 }));
    });
    return;
  }

  if (url.pathname.endsWith('/reports/authenticationMethods/userRegistrationDetails')) {
    if (req.headers.authorization !== 'Bearer mock-token') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'kein gültiges Token' } }));
    }
    const filter = url.searchParams.get('$filter') || '';
    seen.filters.push(filter);
    const match = /^userPrincipalName eq '([^']*)'$/.exec(filter);
    const value = match && USERS[match[1]] ? [USERS[match[1]]] : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ value }));
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'unbekannter Pfad: ' + url.pathname } }));
});

module.exports = { server, PORT, USERS, seen };

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () =>
    console.log(`Entra-Attrappe auf http://127.0.0.1:${PORT}`)
  );
}
