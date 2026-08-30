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

Rollen in der Reihenfolge ihrer Rechte: `user` → `it` → `admin`.
Bevorzugte Quelle sind die Entra-App-Rollen `portal.it` und `portal.admin`.

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
