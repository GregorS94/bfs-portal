// Prüft den Atlassian-Treiber gegen tools/atlassian-mock.js — ohne echte Cloud.
// Aufruf: node tools/atlassian-test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mock = require('./atlassian-mock');

// Eigener Datenordner: sonst liest der Treiber die echten Einstellungen des
// laufenden Portals, und der Test prüft nicht mehr, was er zu prüfen glaubt.
// Genau daran ist er beim ersten Lauf gegen den ausgerollten Container
// gescheitert — dort stand der Projektschlüssel bereits gespeichert.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bfs-atlassian-'));
process.env.DATA_DIR = DATA_DIR;

const PORT = mock.PORT;
process.env.ATLASSIAN_BASE_URL = `http://127.0.0.1:${PORT}`;
process.env.ATLASSIAN_EMAIL = 'portal@bfs.de';
process.env.ATLASSIAN_API_TOKEN = 'mock-token';
process.env.JIRA_PROJECT_KEY = 'ITS';
process.env.JIRA_ISSUE_TYPE = 'Aufgabe';
process.env.CONFLUENCE_SPACE_KEYS = 'IT';

// Im Repo unter backend/drivers, im Container direkt unter /app/drivers.
const atlassian = (() => {
  for (const p of ['../backend/drivers/atlassian', '/app/drivers/atlassian']) {
    try {
      return require(p);
    } catch (err) {
      if (err.code !== 'MODULE_NOT_FOUND') throw err;
    }
  }
  throw new Error('atlassian.js nicht gefunden');
})();

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.log(`  FAIL ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}

(async () => {
  await new Promise((resolve) => mock.server.listen(PORT, '127.0.0.1', resolve));
  console.log('Atlassian-Treiber (gegen Attrappe)');

  await check('Konfiguration wird erkannt', () => {
    assert.strictEqual(atlassian.isConfigured(), true);
    assert.strictEqual(atlassian.jiraReady(), true);
  });

  await check('Confluence-Suche liefert Titel, Auszug und Link', async () => {
    const hits = await atlassian.searchKnowledge('Drucker');
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0].title, 'Drucker einrichten (Windows)');
    assert.ok(hits[0].url.startsWith(`http://127.0.0.1:${PORT}/wiki/`));
    // Die Treffermarkierung von Confluence darf nicht im Chat landen.
    assert.ok(!hits[0].excerpt.includes('@@@'), hits[0].excerpt);
  });

  await check('Bereichsfilter greift', async () => {
    // Die HR-Seite passt inhaltlich, liegt aber außerhalb der erlaubten Bereiche.
    const hits = await atlassian.searchKnowledge('Urlaub');
    assert.strictEqual(hits.length, 0);
    assert.ok(mock.seen.cql.some((c) => c.includes('space in ("IT")')));
  });

  await check('CQL bleibt heil, wenn der Suchtext Anführungszeichen enthält', async () => {
    await atlassian.searchKnowledge('er sagte "kein Drucker" gestern');
    const last = mock.seen.cql[mock.seen.cql.length - 1];
    // Genau ein text-~-Ausdruck, und die inneren Zeichen sind maskiert.
    assert.strictEqual((last.match(/text ~ /g) || []).length, 1);
    assert.ok(last.includes('\\"kein Drucker\\"'), last);
  });

  await check('Seitentext wird nachgeladen und von Markup befreit', async () => {
    const hits = await atlassian.searchKnowledge('Drucker', 5, { withBody: true, bodyCount: 2 });
    assert.strictEqual(hits[0].id, '101');
    assert.ok(hits[0].body, 'kein Seitentext geladen');
    assert.ok(hits[0].body.includes('print01.bfs.local'), hits[0].body);
    // Entities aufgelöst, Markup und Skripte raus.
    assert.ok(hits[0].body.includes('Drucker & Scanner'), hits[0].body);
    assert.ok(!hits[0].body.includes('<'), 'Markup ist im Text geblieben');
    assert.ok(!/egal\(\)/.test(hits[0].body), 'Skriptinhalt ist im Text gelandet');
    assert.ok(mock.seen.pages.includes('101'));
  });

  await check('ohne withBody bleibt es beim Auszug', async () => {
    mock.seen.pages.length = 0;
    const hits = await atlassian.searchKnowledge('VPN');
    assert.strictEqual(hits[0].body, undefined);
    assert.strictEqual(mock.seen.pages.length, 0, 'Seite wurde unnötig geholt');
  });

  await check('eine unerreichbare Seite kippt die Suche nicht', async () => {
    // 999 gibt es in der Attrappe nicht -> 404 im Nachladen.
    await assert.rejects(() => atlassian.fetchPageText('999'), /Atlassian/);
    for (const bad of ['../../etc', '1a', '']) {
      await assert.rejects(() => atlassian.fetchPageText(bad), /Ungültige Seiten-ID/);
    }
  });

  await check('zu kurze Suche wird abgelehnt', async () => {
    await assert.rejects(() => atlassian.searchKnowledge('ab'), /zu kurz/);
  });

  await check('Ticket wird angelegt und liefert Schlüssel und Link', async () => {
    const t = await atlassian.createTicket({
      summary: 'Drucker FLOOR2-HP druckt nicht',
      description: 'Warteschlange geleert, Dienst neu gestartet, Problem bleibt.',
      context: { Gerät: 'PC-4711', Nutzer: 'm.mustermann@bfs.de' }
    });
    assert.ok(/^ITS-\d+$/.test(t.key), t.key);
    assert.strictEqual(t.url, `http://127.0.0.1:${PORT}/browse/${t.key}`);

    const sent = mock.seen.issues[mock.seen.issues.length - 1];
    assert.strictEqual(sent.project.key, 'ITS');
    assert.strictEqual(sent.issuetype.name, 'Aufgabe');
    assert.ok(sent.labels.includes('bfs-portal'));
    // Kontext muss in der Beschreibung stehen, sonst ist die Eskalation wertlos.
    const text = JSON.stringify(sent.description);
    assert.ok(text.includes('PC-4711'), 'Gerät fehlt in der Beschreibung');
  });

  await check('Zugangsdaten werden vor dem Senden entfernt', async () => {
    await atlassian.createTicket({
      summary: 'Anmeldung schlägt fehl',
      description: 'Nutzer nennt sein Passwort: Sommer2026! und ein Token sk-abcdef1234567890.',
      context: { Notiz: 'api-key = geheim123456' }
    });
    const sent = mock.seen.issues[mock.seen.issues.length - 1];
    const text = JSON.stringify(sent.description);
    assert.ok(!text.includes('Sommer2026!'), 'Passwort ist durchgerutscht');
    assert.ok(!text.includes('sk-abcdef1234567890'), 'Token ist durchgerutscht');
    assert.ok(!text.includes('geheim123456'), 'Schlüssel ist durchgerutscht');
    assert.ok(text.includes('[entfernt]'), 'nichts wurde ersetzt');
  });

  await check('Projekt und Vorgangstyp kommen nicht aus dem Aufruf', async () => {
    await atlassian.createTicket({
      summary: 'Versuch, das Projekt zu wechseln',
      description: 'egal',
      // Diese Felder gibt es in der Signatur nicht — sie dürfen nichts bewirken.
      project: { key: 'GEHEIM' },
      issuetype: { name: 'Störung' },
      labels: ['gut', 'bö;se']
    });
    const sent = mock.seen.issues[mock.seen.issues.length - 1];
    assert.strictEqual(sent.project.key, 'ITS');
    assert.strictEqual(sent.issuetype.name, 'Aufgabe');
    // Nur saubere Labels überleben.
    assert.deepStrictEqual(sent.labels, ['bfs-portal', 'gut']);
  });

  await check('Beschreibung geht als ADF raus, nicht als Klartext', () => {
    const adf = atlassian.toAdf('erster Absatz\n\nzweiter Absatz');
    assert.strictEqual(adf.type, 'doc');
    assert.strictEqual(adf.version, 1);
    assert.strictEqual(adf.content.length, 2);
    assert.strictEqual(adf.content[0].content[0].text, 'erster Absatz');
  });

  await check('zu kurzer Titel wird abgelehnt', async () => {
    await assert.rejects(
      () => atlassian.createTicket({ summary: 'hm', description: 'x' }),
      /Titel ist zu kurz/
    );
  });

  await check('Ticketstatus lässt sich abfragen, Schlüssel wird geprüft', async () => {
    const t = await atlassian.getTicket('ITS-101');
    assert.strictEqual(t.key, 'ITS-101');
    assert.strictEqual(t.status, 'Offen');
    for (const bad of ['../../admin', 'ITS 101', 'its-101', '']) {
      await assert.rejects(() => atlassian.getTicket(bad), /Ungültiger Ticket-Schlüssel/);
    }
  });

  await check('ohne Konfiguration wird nicht geraten', async () => {
    const backup = process.env.ATLASSIAN_API_TOKEN;
    delete process.env.ATLASSIAN_API_TOKEN;
    assert.strictEqual(atlassian.isConfigured(), false);
    await assert.rejects(() => atlassian.searchKnowledge('Drucker'), /nicht konfiguriert/);
    process.env.ATLASSIAN_API_TOKEN = backup;
    assert.strictEqual(atlassian.isConfigured(), true);
  });

  await check('ohne Projektschlüssel wird kein Ticket angelegt', async () => {
    const backup = process.env.JIRA_PROJECT_KEY;
    delete process.env.JIRA_PROJECT_KEY;
    await assert.rejects(
      () => atlassian.createTicket({ summary: 'Ein Titel', description: 'x' }),
      /Jira ist nicht konfiguriert/
    );
    process.env.JIRA_PROJECT_KEY = backup;
  });

  mock.server.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(`\n${passed} Prüfungen bestanden${process.exitCode ? ' — mit Fehlern' : ''}.`);
})();
