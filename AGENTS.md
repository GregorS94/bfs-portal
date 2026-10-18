# Hinweise für Agenten

## Vor dem Ändern lesen

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — wie die Teile zusammenhängen
- [`docs/SECURITY.md`](docs/SECURITY.md) — warum bestimmte Dinge umständlich
  aussehen und trotzdem so bleiben müssen
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — die Fallstricke, die schon
  einmal Zeit gekostet haben

## Regeln, die nicht verhandelbar sind

**Befehle entstehen im Backend, nie im Modell.** Wer eine neue Aktion
hinzufügt, schreibt eine Vorlage in `actions.js`, die `file` und `args`
zurückgibt, und ein JSON-Schema für die Parameter. Kein String vom Modell darf
je Teil eines Befehlstextes werden.

**Eine neue Aktion braucht einen Eintrag in der Freigabeliste des Agenten.**
Sonst führt der Agent sie zu Recht nicht aus.

**Aktionen, die fremde Konten betreffen, bekommen `fourEyes: true`.** Dann darf
die anfragende Person den eigenen Auftrag nicht freigeben.

**Das Audit-Log ist verkettet.** Einträge nachträglich zu ändern bricht die
Kette sichtbar — was der Sinn der Sache ist. Wer Einträge programmatisch
entfernt, nutzt `pruneAudit()`, nicht die Datei direkt.

**Neue Backend-Dateien in `backend/Dockerfile` eintragen.** Dort steht eine
Liste einzelner `COPY`-Anweisungen. Wer das vergisst, bekommt
`MODULE_NOT_FOUND` beim Start des Containers.

**Ausgaben schreibender Aktionen gehören nicht zurück ins Modell**, wenn sie
Geheimnisse enthalten können. Dafür gibt es `chat: false`.

**Treibertests setzen ein eigenes `DATA_DIR`.** Sonst laufen sie gegen die
echten gespeicherten Zugangsdaten statt gegen die Testumgebung.

**Was die Datenbank anfasst, wird gegen einen echten Postgres geprueft**, nicht
gegen einen Nachbau. `tools/db-test.js` legt dafuer eine eigene Datenbank
`<name>_test` an und wirft sie weg; ohne erreichbaren Postgres meldet er
„UEBERSPRUNGEN" und bricht nicht ab. Auf dem Host:

```bash
docker compose cp tools bfs-portal-backend:/tmp/tools
docker compose exec backend node /tmp/tools/db-test.js
```

**Wer darf wen aendern, steht in `accounts.js`, nicht in der Route.** Die drei
Faelle, in denen sich das Portal selbst aussperrt (eigenes Konto, eigene
Adminrolle, letzter Administrator), sind dort reine Rechnung und ohne Datenbank
pruefbar. In der Route steht nur der Aufruf.

**Der Passworthash verlaesst `users.js` nur ueber `findForLogin()`.** Alle
anderen Funktionen geben eine Sicht ohne Hash zurueck, damit er nicht
versehentlich in einer JSON-Antwort landet.

## Sprache

Code-Kommentare, Dokumentation und Oberfläche sind auf Deutsch. Bezeichner im
Code sind englisch. Das bleibt so.

## Nach dem Ändern

**Ausrollen und pushen gehören zusammen.** Eine Änderung, die auf dem Host
läuft, aber nicht im Repository steht, ist nach dem nächsten Ausrollen weg:

```bash
scripts/deploy.sh
git add -A && git commit && git push
```

```bash
for t in accounts actions atlassian settings approval audit agents simple-auth \
         agent-allowlist bconnect kiosk; do
  node tools/$t-test.js || break
done
```

Bei Änderungen an der Oberfläche zusätzlich einen Screenshot ziehen — im
dunklen Design sind Kontrastfehler im Code nicht zu sehen. Anleitung in
[`docs/OPERATIONS.md`](docs/OPERATIONS.md).
