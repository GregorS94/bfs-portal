# API

Alle Portal-Endpunkte verlangen eine Anmeldung, sofern nicht anders vermerkt.
Fehlende Rolle → `403`, fehlender oder ungültiger Token → `401`,
fehlende Konfiguration eines Fremdsystems → `503`.

## Offen (ohne Anmeldung)

| Methode | Pfad | Zweck |
|---------|------|-------|
| GET | `/health` | Lebenszeichen des Backends |
| GET | `/api/config` | Entra-Werte für das Frontend zur Laufzeit |
| GET | `/api/health/services` | Status aller Abhängigkeiten — siehe unten |
| POST | `/api/auth/simple` | einfache Anmeldung, nur im Modus `simple` — sonst `404` |
| POST | `/api/auth/local` | Konto und Passwort, nur im Modus `local` — sonst `404` |
## Anmeldung

| Methode | Pfad | Rolle | Zweck |
|---------|------|-------|-------|
| POST | `/api/auth/login` | user | Anmeldung bestätigen |
| GET | `/api/auth/me` | user | eigene Identität und Rolle |
| POST | `/api/auth/password` | user | eigenes Passwort ändern (nur Modus `local`) |

`GET /api/config` nennt unter `mode` den aktiven Anmeldeweg: `entra`, `local`,
`simple` oder `off`. Siehe [CONFIGURATION.md](CONFIGURATION.md).

`POST /api/auth/local` nimmt `{ username, password }` und antwortet mit Token
und Benutzer. Der Fehlertext unterscheidet **nicht** zwischen unbekanntem Konto
und falschem Passwort — sonst wäre die Anmeldemaske eine Kontenliste. Nach fünf
Fehlversuchen je Kennung und Absenderadresse folgt `429` mit Wartezeit.

`POST /api/auth/password` verlangt `{ current, next }` und gibt ein **neues
Token** zurück: Eine Passwortänderung beendet alle Sitzungen des Kontos, und
ohne das neue Token wäre der Ändernde selbst mit abgemeldet.

## Chat

| Methode | Pfad | Rolle | Zweck |
|---------|------|-------|-------|
| POST | `/api/support/chat` | user | SSE-Strom, Tool-Schleife |
| POST | `/api/support/job-summary` | user | Ergebnis eines Auftrags in Prosa |

## Aufträge und Freigaben

| Methode | Pfad | Rolle | Zweck |
|---------|------|-------|-------|
| GET | `/api/jobs` | it | alle Aufträge |
| GET | `/api/jobs/:id` | user | einzelner Auftrag |
| POST | `/api/jobs/:id/approve` | user | freigeben — `user` nur eigene |
| POST | `/api/jobs/:id/deny` | user | ablehnen |
| GET | `/api/devices` | it | bekannte Geräte |
| GET | `/api/audit?limit=` | it | Audit-Log, `limit` 1…1000 (Vorgabe 200) |
| GET | `/api/audit/verify` | admin | Zustand der Hash-Kette |

## Wissen und Tickets

| Methode | Pfad | Rolle | Zweck |
|---------|------|-------|-------|
| GET | `/api/knowledge?q=` | user | Confluence-Volltextsuche über CQL |
| POST | `/api/tickets` | user | Jira-Ticket anlegen (eines je Gespräch) |
| GET | `/api/tickets/:key` | it | Ticketstatus |

## Administration

| Methode | Pfad | Rolle | Zweck |
|---------|------|-------|-------|
| GET | `/api/admin/settings` | admin | alle Gruppen, Geheimnisse nur als `set: true/false` |
| PUT | `/api/admin/settings/:group` | admin | Gruppe speichern |
| POST | `/api/admin/settings/:group/test` | admin | Probelauf gegen das echte System |
| GET | `/api/admin/agents` | admin | Geräte-Token: Übersicht, ohne Token und Hashes |
| POST | `/api/admin/agents/:deviceId/revoke` | admin | Gerät sperren, wirkt sofort |
| POST | `/api/admin/agents/:deviceId/unrevoke` | admin | Sperre aufheben; das Gerät muss sich neu anmelden |

Ein leer gelassenes Geheimnisfeld bedeutet „nicht anfassen". Zum Entfernen
`null` senden.

### Konten

Nur im Modus `local`; in jedem anderen Modus antworten diese Routen mit `400`.
Der Passworthash verlässt das Backend nie.

| Methode | Pfad | Rolle | Zweck |
|---------|------|-------|-------|
| GET | `/api/admin/users` | admin | alle Konten, dazu `defaultsPending` |
| POST | `/api/admin/users` | admin | Konto anlegen (`username`, `password`, `role`, `displayName`) |
| PATCH | `/api/admin/users/:id` | admin | `role`, `active`, `displayName` |
| POST | `/api/admin/users/:id/password` | admin | Passwort setzen — gilt als vorläufig |
| DELETE | `/api/admin/users/:id` | admin | Konto löschen |

Drei Änderungen weist das Backend immer ab, weil sich das Portal damit selbst
aussperrt: das eigene Konto löschen oder sperren, die eigene Administratorrolle
abgeben, und den letzten aktiven Administrator löschen, sperren oder
herabsetzen. Die Regel steht in `backend/accounts.js` (`changeProblem`) und ist
ohne Datenbank prüfbar.

Sperren und jede Passwortänderung zählen die Token-Fassung des Kontos hoch.
Laufende Sitzungen enden damit sofort, ohne dass das Portal eine Liste gültiger
Token führen müsste.

## Kiosk (Software anfordern)

Das Portal **installiert nichts**. Es erteilt eine Freigabe in der bMS
(`POST /v2.0/KioskReleases`), und der Anwender installiert selbst im baramundi
Kiosk. Einzelheiten und Belege in [BARAMUNDI.md](BARAMUNDI.md).

| Methode | Pfad | Rolle | Zweck |
|---------|------|-------|-------|
| GET | `/api/kiosk/catalog` | user | freigebbare Jobs, Kiosk-Adresse, eigener Stand |
| POST | `/api/kiosk/requests` | user | anfordern (`jobDefinitionId`, `note`) |
| GET | `/api/kiosk/requests?open=` | it | alle Anforderungen |
| POST | `/api/kiosk/requests/:id/release` | it | freigeben (`assignmentTargetId` Pflicht) |
| POST | `/api/kiosk/requests/:id/deny` | it | ablehnen (`note`) |
| POST | `/api/kiosk/requests/:id/withdraw` | it | Freigabe zurückziehen |
| GET | `/api/kiosk/targets?q=` | it | Zuweisungsziele im Verzeichnis suchen (`GET /v2.0/ADUsers`, `/v2.0/ADObjects`). Jede Suche wird protokolliert |

Die angeforderte Jobkennung wird gegen den Katalog aufgelöst, nicht übernommen:
Sonst könnte jemand eine beliebige Jobdefinition anfordern, und die IT gäbe sie
im Vertrauen auf den angezeigten Namen frei.

Beim Freigeben ruft das Portal **erst** die bMS und schreibt **danach** die
eigene Tabelle. Scheitert der Aufruf, bleibt die Anforderung offen; in der
umgekehrten Reihenfolge stünde „freigegeben" in der Tabelle, ohne dass im Kiosk
etwas erschienen wäre.

## Agent

Eigene Token im `Authorization: Bearer`-Kopf, nicht Entra. Es gibt zwei:

- Das **Anmelde-Token** (`AGENT_TOKEN` aus der `.env`) gilt nur für
  `/api/agent/register`.
- Das **Geräte-Token** wird bei der Anmeldung vergeben und gilt für alles
  Weitere — geprüft gegen genau die Gerätekennung aus der Anfrage. Ein Agent
  kann damit nur seine eigenen Aufträge abholen.

Die Gerätekennung kommt aus `?deviceId=`, dem Feld `deviceId` im Body oder dem
Kopf `X-Device-Id`.

| Methode | Pfad | Token | Zweck |
|---------|------|-------|-------|
| POST | `/api/agent/register` | Anmelde-Token | Gerät anmelden, liefert `agentToken` |
| POST | `/api/agent/heartbeat` | Geräte-Token | Lebenszeichen, ohne neues Token |
| GET | `/api/agent/jobs?deviceId=` | Geräte-Token | Long-Poll auf freigegebene Aufträge |
| POST | `/api/agent/jobs/:id/result` | Geräte-Token | Ergebnis zurückmelden |

Ein erneutes `register` vergibt ein neues Token und entwertet das alte — so
lässt sich rotieren. Ein gesperrtes Gerät bekommt `403`; sonst wäre die Sperre
wirkungslos, weil jeder mit dem Anmelde-Token neu anfangen könnte.

Für den laufenden Betrieb ist `heartbeat` der richtige Weg: Es hält „zuletzt
gesehen" aktuell, ohne bei jedem Durchlauf ein Token zu vergeben und einen
Audit-Eintrag zu erzeugen.

## `GET /api/health/services`

Für externes Monitoring gedacht und deshalb ungeschützt. Neben den
Einzelstatus (`ok` / `warn` / `error` / `unbekannt`) enthält die Antwort
`overall` und eine flache Karte `statuses` mit stabilen Zeichenketten:

```json
{ "overall": "ok", "statuses": { "claude": "ok", "agent": "ok", "audit": "ok" } }
```

Damit lässt sich ohne JSON-Pfad auf Schlüsselwörter prüfen. Die Claude-Prüfung
nutzt `models.retrieve` — das kostet keine Tokens — und wird 30 Sekunden
zwischengespeichert.
