## Was ändert sich

<!-- Ein Absatz: was und warum. Nicht was im Diff steht, sondern was es soll. -->

## Geprüft

- [ ] `node tools/actions-test.js && node tools/atlassian-test.js && node tools/entra-test.js && node tools/settings-test.js`
- [ ] `node tools/approval-test.js && node tools/audit-test.js && node tools/agents-test.js`
- [ ] In der Testumgebung ausgerollt (`docker-compose.staging.yml`)
- [ ] Bei Oberflächenänderungen: Screenshot geprüft

## Sicherheitsrelevant

- [ ] Keine Zugangsdaten im Diff
- [ ] Neue Backend-Dateien in `backend/Dockerfile` ergänzt
- [ ] Bei neuer Aktion: Freigabeliste des Agenten ergänzt, `risk` gesetzt,
      `fourEyes` erwogen
