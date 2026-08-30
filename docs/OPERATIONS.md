# Betrieb und Fallstricke

## Änderungen ausrollen

**Das Repository ist die Quelle der Wahrheit, nicht der Pi.** Geändert wird
hier, ausgerollt wird von hier — wer direkt auf dem Host editiert, verliert die
Änderung beim nächsten Ausrollen und im Repository fehlt sie ohnehin.

```bash
scripts/check-drift.sh    # steht auf dem Host etwas, das das Repo nicht kennt?
scripts/deploy.sh         # kopieren, Container neu bauen, Status zeigen
git add -A && git commit && git push
```

`deploy.sh` ruft `check-drift.sh` selbst auf und bricht ab, wenn der Host
Stände hat, die das Repository nicht kennt — sonst überschriebe das Ausrollen
sie stillschweigend. Am Ende meldet es Commits, die noch nicht gepusht sind.

Beide Skripte nehmen `DEPLOY_HOST` und `DEPLOY_DIR` aus der Umgebung; ohne
Angabe gilt `steppat@pihole:~/bfs-portal`.

Die `.env` bleibt vom Ausrollen ausgenommen und liegt nur auf dem Host — sie
enthält die Zugangsdaten und gehört nicht ins Repository.

## Tests

Alle Treibertests laufen gegen Attrappen in `tools/`, die die Request-Formen
der echten Systeme nachbauen. Das genügt, um Filterlogik, Maskierung und
Injektionsabwehr zu prüfen — und kostet keine echten Tickets.

```bash
node tools/actions-test.js      #  8 Prüfungen: AD-Aktionen, Eingabevalidierung
node tools/atlassian-test.js    # 16 Prüfungen: CQL, ADF, Ticket-Wiederverwendung
node tools/entra-test.js        #  7 Prüfungen: SSPR-Triage, OData-Injektion
node tools/settings-test.js     # 11 Prüfungen: Geheimnisse, Vorrang, Rollen
node tools/approval-test.js     # 20 Prüfungen: Freigaberechte, Vier-Augen
node tools/audit-test.js        # 18 Prüfungen: Hash-Kette, Aufbewahrung
node tools/agents-test.js       # 22 Prüfungen: Geräte-Token, Sperren
```

Alle sieben laufen ohne Server und ohne installierte Abhängigkeiten.

**Ablehnungsprüfungen müssen den Grund prüfen, nicht nur den Fehlschlag.**
Sonst bestehen sie auch dann, wenn die Aktion gar nicht ausgerollt ist.

**Seit es `settings.js` gibt, ist `process.env` allein keine verlässliche
Testumgebung mehr.** Die Treiber lesen gespeicherte Einstellungen mit Vorrang.
Beide Treibertests setzen deshalb ein eigenes `DATA_DIR`. Wer das vergisst,
testet gegen die echten hinterlegten Zugangsdaten.

## Oberfläche prüfen

Ein direkter HTTP-Zugriff auf den Pi vom Entwicklungsrechner aus funktioniert
nicht. Über einen SSH-Tunnel und Chrome im Headless-Modus geht es:

```bash
ssh -L 9500:127.0.0.1:9000 <user>@<host>
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --screenshot=/tmp/portal.png --window-size=1600,1200 \
  http://127.0.0.1:9500/
```

Das hat zwei echte Fehler aufgedeckt, die im Code nicht auffielen: eine leere
Chat-Fläche ohne Startzustand, und `text-slate-800` in der Auftragsliste —
dunkel auf dunkel, unsichtbar, weil die Klasse in der Umstellungstabelle aufs
dunkle Design fehlte.

## Audit-Log prüfen

```bash
DATA_DIR=/pfad/zum/data node tools/audit-verify.js
```

Exit 0 heißt: Die Hash-Kette ist unversehrt. Exit 1 nennt Zeile und Grund. Das
Backend führt dieselbe Prüfung bei jedem Start aus und schreibt das Ergebnis in
die Konsole:

```
Audit-Log: 94 Einträge, Kette unversehrt.
```

Eine gebrochene Kette bricht den Start nicht ab — ein Befund ist kein Grund,
den Support stillzulegen. Sie gehört aber untersucht.

Einträge älter als `AUDIT_RETENTION_DAYS` werden beim Start und danach täglich
entfernt. Ohne gesetzte Frist passiert nichts.

## Testumgebung

```bash
docker compose -f docker-compose.staging.yml up -d --build
```

Eigener Projektname, eigene Ports (9010/9011/9012), eigenes Volume. Ein
Versuch dort berührt weder die laufende Instanz noch deren Audit-Log.

## Status im Blick behalten

`GET /api/health/services` prüft Backend, Claude API, Geräte-Agenten,
bConnect, Audit-Log, Attrappen-API und Agent-Token. Der Tab „Status" unter
`/admin` aktualisiert sich alle 15 Sekunden selbst.

Als externer Wächter läuft Uptime Kuma in einem **eigenen** Compose-Stack —
bewusst nicht im Portal-Stack, damit ein `docker compose down` im Portal ihn
nicht mitnimmt. Grenze: er läuft auf demselben Gerät und fängt damit
Container- und Anwendungsausfälle, nicht den Ausfall des Geräts selbst.

## Freigabe auf `main`

Branch Protection lässt sich nur in den Repository-Einstellungen setzen, nicht
aus dem Code heraus. Für den Produktivbetrieb verlangen MaRisk und DORA das
Vier-Augen-Prinzip auch bei Änderungen:

GitHub → Settings → Branches → Add rule für `main`:
- Require a pull request before merging
- Require approvals: 1
- Do not allow bypassing the above settings

Die Vorlage unter `.github/pull_request_template.md` führt die Prüfschritte
auf, die dabei abzuhaken sind.

## Fallen, die schon zugeschnappt sind

**`backend/Dockerfile` listet die zu kopierenden Dateien einzeln auf**
(`COPY index.js actions.js jobs.js auth.js ...`). Eine neue Backend-Datei muss
dort ergänzt werden, sonst startet der Container mit `MODULE_NOT_FOUND`.

**`req.on('close')` feuert in Express bereits, wenn der Body gelesen ist.**
Der Abbruch eines SSE-Stroms gehört an `res`, mit einem `finished`-Flag.

**BusyBox-`wget` löst `localhost` auf `::1` auf**, Node lauscht nur auf IPv4.
Healthchecks brauchen `127.0.0.1`.

**Der Abschlussaufruf nach `tool_result`-Blöcken braucht `tools`.** Ohne
Werkzeugdefinitionen liefert die API 0 Ausgabe-Token. Werkzeuge deklarieren
und `tool_choice: { type: 'none' }` setzen.

**Ein Named Volume erbt den Besitzer aus dem Image.** `chown node:node /data`
muss vor `USER node` stehen.

**Der Agent muss zyklisch ein Lebenszeichen senden**, sonst ist er nach einem
Backend-Neustart unsichtbar. Dafür ist `/api/agent/heartbeat` da, **nicht**
`register`: Eine erneute Anmeldung vergibt jedes Mal ein neues Token und
schreibt einen Audit-Eintrag. Als der Agent das im 40-Sekunden-Takt tat, standen
binnen Minuten sieben Anmeldungen im Log.

**macOS-`tar` schleppt `._`-Dateien mit.** Nach dem Entpacken auf dem Zielhost
löschen.

**`proxy_buffering off`** in `nginx.conf` ist Pflicht, sonst kommt der
SSE-Strom erst am Stück beim Browser an.

## Datenhaltung

| Was | Wo | Überlebt Neustart |
|-----|----|-------------------|
| Audit-Log | `/data/audit.jsonl` im Volume `audit_data` | ja |
| Einstellungen | `/data/settings.json`, 0600 | ja |
| Geräte-Token | `/data/agents.json`, 0600 | ja |
| Aufträge, Geräte | RAM | nein |
| Ticket je Gespräch | RAM | nein |
