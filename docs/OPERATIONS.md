# Betrieb und Fallstricke

## Tests

Alle Treibertests laufen gegen Attrappen in `tools/`, die die Request-Formen
der echten Systeme nachbauen. Das genügt, um Filterlogik, Maskierung und
Injektionsabwehr zu prüfen — und kostet keine echten Tickets.

```bash
node tools/actions-test.js      #  8 Prüfungen
node tools/atlassian-test.js    # 13 Prüfungen
node tools/entra-test.js        #  7 Prüfungen
node tools/settings-test.js     # 11 Prüfungen
```

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

## Status im Blick behalten

`GET /api/health/services` prüft Backend, Claude API, Geräte-Agenten,
bConnect, Audit-Log, Attrappen-API und Agent-Token. Der Tab „Status" unter
`/admin` aktualisiert sich alle 15 Sekunden selbst.

Als externer Wächter läuft Uptime Kuma in einem **eigenen** Compose-Stack —
bewusst nicht im Portal-Stack, damit ein `docker compose down` im Portal ihn
nicht mitnimmt. Grenze: er läuft auf demselben Gerät und fängt damit
Container- und Anwendungsausfälle, nicht den Ausfall des Geräts selbst.

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

**Der Agent muss sich zyklisch neu registrieren**, sonst ist er nach einem
Backend-Neustart unsichtbar.

**macOS-`tar` schleppt `._`-Dateien mit.** Nach dem Entpacken auf dem Zielhost
löschen.

**`proxy_buffering off`** in `nginx.conf` ist Pflicht, sonst kommt der
SSE-Strom erst am Stück beim Browser an.

## Datenhaltung

| Was | Wo | Überlebt Neustart |
|-----|----|-------------------|
| Audit-Log | `/data/audit.jsonl` im Volume `audit_data` | ja |
| Einstellungen | `/data/settings.json`, 0600 | ja |
| Aufträge, Geräte | RAM | nein |
| Ticket je Gespräch | RAM | nein |
