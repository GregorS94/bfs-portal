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

**Neue Backend-Dateien in `backend/Dockerfile` eintragen.** Dort steht eine
Liste einzelner `COPY`-Anweisungen. Wer das vergisst, bekommt
`MODULE_NOT_FOUND` beim Start des Containers.

**Ausgaben schreibender Aktionen gehören nicht zurück ins Modell**, wenn sie
Geheimnisse enthalten können. Dafür gibt es `chat: false`.

**Treibertests setzen ein eigenes `DATA_DIR`.** Sonst laufen sie gegen die
echten gespeicherten Zugangsdaten statt gegen die Testumgebung.

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
node tools/actions-test.js && node tools/atlassian-test.js \
  && node tools/entra-test.js && node tools/settings-test.js
```

Bei Änderungen an der Oberfläche zusätzlich einen Screenshot ziehen — im
dunklen Design sind Kontrastfehler im Code nicht zu sehen. Anleitung in
[`docs/OPERATIONS.md`](docs/OPERATIONS.md).
