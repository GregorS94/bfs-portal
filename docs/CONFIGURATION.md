# Konfiguration

Es gibt zwei Wege, und sie haben eine klare Rangfolge:

```
gespeicherte Einstellung (Oberfläche)  >  .env  >  Vorgabewert
```

Die Oberfläche ist der Weg für einen Menschen, der gerade ein API-Token in der
Hand hat. Die `.env` ist der Weg für automatisierte Installationen.

Gespeicherte Werte liegen in `/data/settings.json` (Rechte 0600) im selben
Volume wie das Audit-Log. Treiber lesen bei jedem Zugriff frisch — eine
Änderung wirkt ohne Neustart.

## Nur `.env`

| Variable | Vorgabe | Bedeutung |
|----------|---------|-----------|
| `ANTHROPIC_API_KEY` | — | **Pflicht.** Ohne ihn startet das Backend, aber jede Chat-Anfrage scheitert |
| `AGENT_TOKEN` | — | **Pflicht.** Anmelde-Token für Agenten; danach hat jedes Gerät ein eigenes |
| `AUDIT_RETENTION_DAYS` | `0` | Aufbewahrung des Audit-Logs in Tagen; 0 = unbegrenzt |
| `PORT` | `3000` | Port im Container |
| `DATA_DIR` | `/data` | Ablage für Audit-Log und Einstellungen |
| `MOCK_API_HOST` | `mock-api` | Host der Attrappen-API |

## Anmeldung und Rollen

| Variable | Vorgabe | Bedeutung |
|----------|---------|-----------|
| `ENTRA_ENABLED` | `false` | `true` schaltet die JWT-Prüfung scharf |
| `ENTRA_TENANT_ID` | — | Pflicht, wenn aktiviert |
| `ENTRA_CLIENT_ID` | — | Pflicht, wenn aktiviert |
| `ENTRA_API_SCOPE` | — | Pflicht, wenn aktiviert |
| `ENTRA_IT_USERS` | leer | UPNs mit Rolle `it`, kommagetrennt — Notnagel ohne App-Rollen |
| `ENTRA_ADMIN_USERS` | leer | dito für `admin` |
| `DEV_ROLE` | `admin` | Rolle des Entwicklungs-Benutzers, wenn Entra aus ist |
| `DEV_USER_ID` | `dev@bfs.local` | Kennung des Entwicklungs-Benutzers. Zum Durchspielen des Vier-Augen-Prinzips ohne Entra: zwei Instanzen mit verschiedenen Kennungen starten |
| `DEV_USER_NAME` | `Entwicklungs-Benutzer` | Anzeigename des Entwicklungs-Benutzers |
| `SIMPLE_LOGIN` | `false` | `true` schaltet den einfachen Anmeldeweg frei (nur wirksam, wenn `ENTRA_ENABLED` aus ist) |
| `SIMPLE_LOGIN_SECRET` | je Start erzeugt | Schlüssel für die Sitzungen des einfachen Wegs. Ohne festen Wert sind alle nach einem Neustart abgemeldet |

**Drei Anmeldewege, genau einer ist zu jeder Zeit aktiv.** Das Backend meldet
den aktiven Weg unter `GET /api/config` als `mode`:

| `mode` | wann | was geprüft wird |
|--------|------|------------------|
| `entra` | `ENTRA_ENABLED=true` | Microsoft-Token gegen die JWKS des Mandanten. Der einzige Weg für den Echtbetrieb |
| `simple` | sonst, mit `SIMPLE_LOGIN=true` | **nichts.** Der Nutzer tippt einen Namen, das Portal glaubt ihn |
| `off` | sonst | fester Entwicklungs-Benutzer aus `DEV_USER_ID` |

Rollen in der Reihenfolge ihrer Rechte: `user` → `it` → `admin`.
Bevorzugte Quelle sind die Entra-App-Rollen `portal.it` und `portal.admin`.
Im Modus `simple` kommen die Rollen aus `ENTRA_IT_USERS` / `ENTRA_ADMIN_USERS` —
dieselben Listen, damit es nicht zwei Quellen der Wahrheit gibt.

**`simple` ist keine Authentifizierung.** Wer den Anmeldenamen eines anderen
eintippt, ist im Portal dieser andere — auch mit dessen Rolle, wenn er in den
Namenslisten steht. Der Weg ist für den Prototyp gedacht: die Sitzung ist im
Portal sichtbar als „Identität ungeprüft" markiert und im Audit-Log als
`verified: false` vermerkt. Für den Echtbetrieb `ENTRA_ENABLED=true`.

## Öffentliche Passwort-Hilfe

`POST /api/public/password-help` ist die einzige Route, die ohne Anmeldung
etwas anlegt — sie muss es sein, denn wer sein Passwort vergessen hat, kommt
nicht ins Portal.

| Variable | Vorgabe | Bedeutung |
|----------|---------|-----------|
| `PUBLIC_RATE_MAX` | `5` | Anfragen je Absender im Zeitfenster |
| `PUBLIC_RATE_WINDOW_MINUTES` | `15` | Länge des Zeitfensters |

Die Zählung läuft über `req.ip`. Das Backend vertraut dafür genau einem
Zwischenschritt (`app.set('trust proxy', 1)`) — nginx. Steht ein weiterer
Proxy davor, muss dieser Wert mitwachsen, sonst landen alle Absender in einem
Topf.

**Unvollständig konfiguriert blockiert.** `ENTRA_ENABLED=true` ohne die drei
IDs liefert 500 auf allen Portal-Routen, statt still auf den
Entwicklungs-Benutzer zurückzufallen.

## Atlassian (Confluence + Jira)

Auch über die Oberfläche setzbar, Gruppe `atlassian`.

| Variable | Feld in der Oberfläche | Bedeutung |
|----------|------------------------|-----------|
| `ATLASSIAN_BASE_URL` | Adresse der Instanz | z. B. `https://firma.atlassian.net` |
| `ATLASSIAN_EMAIL` | E-Mail des technischen Kontos | Basic-Auth-Benutzer |
| `ATLASSIAN_API_TOKEN` | API-Token | Geheimnis |
| `JIRA_PROJECT_KEY` | Jira-Projektschlüssel | Ziel neuer Tickets |
| `JIRA_ISSUE_TYPE` | Vorgangstyp | Vorgabe `Aufgabe` |
| `CONFLUENCE_SPACE_KEYS` | Confluence-Bereiche | kommagetrennt, begrenzt die Suche |

Projekt und Vorgangstyp kommen ausschließlich von hier — nie aus einem Aufruf
oder aus dem Modell. Sonst legt ein Gespräch Tickets in fremden Projekten an.

## Microsoft Graph (SSPR-Triage)

Gruppe `entra` in der Oberfläche.

| Variable | Bedeutung |
|----------|-----------|
| `ENTRA_GRAPH_CLIENT_ID` | Anwendungs-ID der Graph-App |
| `ENTRA_GRAPH_CLIENT_SECRET` | Geheimnis |
| `ENTRA_AUTH_BASE` | nur für Tests gegen eine Attrappe |
| `ENTRA_GRAPH_BASE` | nur für Tests gegen eine Attrappe |

Benötigte App-Berechtigung: **`AuditLog.Read.All`** für
`/reports/authenticationMethods/userRegistrationDetails`.

## baramundi bConnect

Nur `.env`, nicht in der Oberfläche.

| Variable | Vorgabe | Bedeutung |
|----------|---------|-----------|
| `BCONNECT_SERVER` | — | Hostname des Management Centers |
| `BCONNECT_PORT` | `443` | |
| `BCONNECT_VERSION` | `v1.0` | Pfadbestandteil der bConnect-Adresse |
| `BCONNECT_USER` | — | HTTP Basic |
| `BCONNECT_PASSWORD` | — | HTTP Basic |
| `BCONNECT_ALLOW_SELF_SIGNED` | `false` | für Testinstallationen |
| `BCONNECT_ALLOWED_JOBS` | leer | **ohne diese Liste ist nichts ausführbar** |

Der bMS-Katalog enthält auch Rollouts und Compliance-Läufe. Nur was hier
ausdrücklich steht, darf ausgelöst werden.

Getestet gegen bMC **26.1.161.0**. Die Zustandsfelder einer JobInstance werden
an genau einer Stelle ausgewertet: `interpretState()` in
`backend/drivers/bconnect.js`.

## Geräte-Agent

Eigene Datei `/etc/bfs-agent.env` auf dem Zielrechner, Rechte 0600.

| Variable | Vorgabe | Bedeutung |
|----------|---------|-----------|
| `PORTAL_URL` | `http://127.0.0.1:9001` | Adresse des Backends |
| `AGENT_TOKEN` | — | **Pflicht** für die erste Anmeldung, identisch zum Portal |
| `AGENT_TOKEN_FILE` | `/etc/bfs-agent.token` | Ablage des geräteeigenen Tokens, 0600 |
| `DEVICE_ID` | Hostname | Kennung des Geräts |

Nach der ersten Anmeldung braucht der Agent `AGENT_TOKEN` nicht mehr — er
arbeitet mit dem Token aus `AGENT_TOKEN_FILE`. Löscht man diese Datei, meldet
er sich beim nächsten Start neu an und bekommt ein frisches Token; das alte
verfällt dabei.
