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
| `BOT_API_TOKEN` | — | **Pflicht.** Token des Copilot-Studio-Agents; fehlt er, antwortet `/api/bot/*` mit 503 |
| `AGENT_TOKEN` | — | **Pflicht.** Anmelde-Token für Agenten; danach hat jedes Gerät ein eigenes |
| `CHAT_ENABLED` | `false` | Eigener Chat im Portal (Vorführweg ohne M365). Aus heißt: keine KI im Backend |
| `ANTHROPIC_API_KEY` | — | Nur mit `CHAT_ENABLED=true` nötig. Der Client entsteht erst beim ersten Chat-Aufruf |
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
| `SIMPLE_LOGIN` | `false` | `true` schaltet den einfachen Anmeldeweg frei (nur wirksam, wenn `ENTRA_ENABLED` und `LOCAL_LOGIN` aus sind) |
| `SIMPLE_LOGIN_SECRET` | je Start erzeugt | Schlüssel für die Sitzungen des einfachen Wegs. Ohne festen Wert sind alle nach einem Neustart abgemeldet |
| `LOCAL_LOGIN` | `false` | `true` schaltet Konto und Passwort aus der Datenbank frei (nur wirksam, wenn `ENTRA_ENABLED` aus ist) |
| `LOCAL_LOGIN_SECRET` | je Start erzeugt, ersatzweise `SIMPLE_LOGIN_SECRET` | Schlüssel für die Sitzungen des lokalen Wegs |
| `LOCAL_SESSION_HOURS` | `12` | Laufzeit einer lokalen Sitzung |
| `LOCAL_ADMIN_USER` / `LOCAL_ADMIN_PASSWORD` | `admin` / `admin` | Startkonto mit Rolle `admin` |
| `LOCAL_USER_USER` / `LOCAL_USER_PASSWORD` | `user` / `1234` | Startkonto mit Rolle `user` |

**Die Startpasswörter sind fest.** Niemand wird beim ersten Anmelden zu einer
Änderung gezwungen — das war eine ausdrückliche Entscheidung (Gregor,
2026-10-18). Das Portal zeigt in der Kontenliste nur einen Hinweis
„Startpasswort", solange das ausgelieferte Passwort noch gilt; beim Umzug in
den Betrieb soll `admin/admin` nicht unbemerkt weiterlaufen. Gesät werden die
Konten einmalig, wenn die Tabelle leer ist. Zurücksetzen auf die Werte oben:

```bash
docker compose cp tools backend:/tmp/tools
docker compose exec backend node /tmp/tools/startpasswoerter.js        # beide
docker compose exec backend node /tmp/tools/startpasswoerter.js admin  # nur eines
```

Das beendet laufende Sitzungen der betroffenen Konten. Beim Start passiert es
bewusst **nicht** — ein Neustart darf niemals das Passwort eines echten
Administrators überschreiben.

**Vier Anmeldewege, genau einer ist zu jeder Zeit aktiv.** Das Backend meldet
den aktiven Weg unter `GET /api/config` als `mode`:

| `mode` | wann | was geprüft wird |
|--------|------|------------------|
| `entra` | `ENTRA_ENABLED=true` | Microsoft-Token gegen die JWKS des Mandanten. Der einzige Weg für den Echtbetrieb |
| `local` | sonst, mit `LOCAL_LOGIN=true` | **ein Passwort**, scrypt-gehasht, gegen die Tabelle `portal_users`. Geprüft wird gegen das Portal, nicht gegen das Unternehmensverzeichnis |
| `simple` | sonst, mit `SIMPLE_LOGIN=true` | **nichts.** Der Nutzer tippt einen Namen, das Portal glaubt ihn |
| `off` | sonst | fester Entwicklungs-Benutzer aus `DEV_USER_ID` |

**Im Modus `local` kommen die Rollen aus der Datenbank**, nicht aus den
Namenslisten — und zwar bei jeder Anfrage neu. Entzieht ein Administrator eine
Rolle, wirkt das sofort und nicht erst beim nächsten Anmelden.

**Die Startkonten werden nur angelegt, wenn die Tabelle leer ist.** Ein
gelöschtes `admin` kommt durch einen Neustart nicht zurück. Beide Startkonten
sind als „muss geändert werden" markiert; solange das so ist, nennt die
Administrationsseite sie beim Namen und die Anmeldemaske warnt.

Rollen in der Reihenfolge ihrer Rechte: `user` → `it` → `admin`.
Bevorzugte Quelle sind die Entra-App-Rollen `portal.it` und `portal.admin`.
Im Modus `simple` kommen die Rollen aus `ENTRA_IT_USERS` / `ENTRA_ADMIN_USERS` —
dieselben Listen, damit es nicht zwei Quellen der Wahrheit gibt.

**`simple` ist keine Authentifizierung.** Wer den Anmeldenamen eines anderen
eintippt, ist im Portal dieser andere — auch mit dessen Rolle, wenn er in den
Namenslisten steht. Der Weg ist für den Prototyp gedacht: die Sitzung ist im
Portal sichtbar als „Identität ungeprüft" markiert und im Audit-Log als
`verified: false` vermerkt. Für den Echtbetrieb `ENTRA_ENABLED=true`.

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

## baramundi bConnect

Nur `.env`, nicht in der Oberfläche.

| Variable | Vorgabe | Bedeutung |
|----------|---------|-----------|
| `BCONNECT_SERVER` | — | Hostname des Management Centers |
| `BCONNECT_PORT` | `443` | |
| `BCONNECT_VERSION` | `v2.0` | `v1.0` oder `v2.0` — siehe unten |
| `BCONNECT_API_KEY` | — | nur v2; wird `BCONNECT_USER`/`PASSWORD` vorgezogen |
| `BCONNECT_USER` | — | HTTP Basic |
| `BCONNECT_PASSWORD` | — | HTTP Basic |
| `BCONNECT_ALLOW_SELF_SIGNED` | `false` | für Testinstallationen |
| `BCONNECT_POLL_MS` | `5000` | Abstand zwischen zwei Statusabfragen |
| `BCONNECT_KIOSK_JOBS` | leer | Jobnamen, die das Portal **im Kiosk freigeben** darf. Leer heisst: der Kiosk-Bereich ist aus. Bewusst getrennt von `BCONNECT_ALLOWED_JOBS` — das eine erlaubt dem Chat, etwas auszuführen, das andere einem Mitarbeiter, sich etwas zu installieren |
| `BCONNECT_KIOSK_URL` | aus `BCONNECT_SERVER` gebildet | Adresse der Kiosk-Weboberfläche, Vorgabe `https://{server}/bWebServer/Kiosk` |
| `BCONNECT_ALLOWED_JOBS` | leer | **ohne diese Liste ist nichts ausführbar** |

Der bMS-Katalog enthält auch Rollouts und Compliance-Läufe. Nur was hier
ausdrücklich steht, darf ausgelöst werden.

### Welche Fassung?

`v2.0` ist die Vorgabe: BFS fährt bMC 26.1, und v2 erlaubt die Anmeldung per
Schlüssel statt per Dienstkonto — ein Schlüssel lässt sich zurückziehen, ohne
dass jemand ein Kennwort ändern muss. Dazu benutzt v2 gewöhnliche REST-Formen,
während v1 eine JobInstance per `GET` anlegt.

Nur v2 kann die **installierte Software eines Geräts lesen**
(`list_installed_software`). Dieses Werkzeug hängt bewusst **nicht** an
`BCONNECT_ALLOWED_JOBS` — die Liste begrenzt, was ausgeführt werden darf, nicht
was gelesen werden darf. `v1.0` bleibt für ältere Installationen erreichbar,
dort fehlt das Werkzeug.

Der Treiber spricht beide; welche, entscheidet allein `BCONNECT_VERSION`. Die
Adressen und Feldnamen beider Fassungen stehen im Kopfkommentar von
`backend/drivers/bconnect.js`, die Abwägung samt offener Fragen an die IT in
[`BARAMUNDI.md`](BARAMUNDI.md).

Die Request-Formen sind aus den Herstellermodulen abgeleitet — v1 aus
PS-bConnect, v2 aus bConnectV2 26.1.101, das zu bMC 26.1 gehört. **Gegen einen
echten bMS-Server ist keine der beiden Fassungen gelaufen**, verifiziert sind
sie nur gegen `tools/bconnect-mock.js` (`node tools/bconnect-test.js`, 27
Prüfungen). Die Zustandsfelder einer JobInstance werden an genau einer Stelle
ausgewertet: `interpretState()` in `backend/drivers/bconnect.js`.

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

## Datenbank (Postgres)

Trägt die Konten (`portal_users`) und die Kiosk-Anforderungen
(`kiosk_requests`). Alles andere liegt weiter in Dateien oder im RAM — siehe
[OPERATIONS.md](OPERATIONS.md#datenhaltung).

| Variable | Vorgabe | Bedeutung |
|----------|---------|-----------|
| `DB_PASSWORD` | — | **Pflicht**, auch für `docker compose`: der Postgres-Container bekommt sie als `POSTGRES_PASSWORD`. Ohne sie bricht `docker compose up` ab |
| `DB_HOST` | `db` | der Container im selben Netz |
| `DB_PORT` | `5432` | |
| `DB_NAME` | `bfs_portal` | |
| `DB_USER` | `portal` | |
| `DATABASE_URL` | — | vollständiger Verbindungsstring; hat Vorrang vor den fünf Werten oben |

Das Schema legt das Backend beim Start selbst an (`CREATE TABLE IF NOT
EXISTS`). Zwei Tabellen rechtfertigen keine Migrationsbibliothek.

**Warum Postgres und nicht Supabase:** Supabase ist Postgres plus Auth,
Storage, Realtime und Studio — Dienste, die das Portal nicht benutzt und die
auf einem Raspberry Pi 5 viel Speicher für nichts belegen. Das Datenmodell ist
reines SQL; ein Umzug auf Supabase oder einen Unternehmensserver ist ein
Verbindungsstring, kein Umbau.

**Ohne Datenbank bleibt der lokale Weg aus, aber sichtbar.** `LOCAL_LOGIN=true`
ohne erreichbare Datenbank liefert `503` beim Anmelden und an jeder
Portal-Route. Ein stiller Durchlauf wäre hier die Lücke: dann wäre die
Datenbank die Rechtevergabe, und ihr Ausfall eine Rechteerweiterung.
