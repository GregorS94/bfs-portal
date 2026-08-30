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
| POST | `/api/public/password-help` | „Passwort vergessen" vom Anmeldebildschirm |

### `POST /api/public/password-help`

Die einzige offene Route, die etwas anlegt. Body: `identity` (Pflicht),
`contact`, `note`.

Die Antwort ist **immer dieselbe** — `202` mit einem neutralen Text, auch bei
unbekanntem Konto und auch, wenn die Begrenzung greift. Ein abweichender Status
wäre ein Orakel, mit dem sich alle Anmeldenamen des Hauses durchprobieren
liessen. Nur ein formal ungültiger Anmeldename liefert `400`; daraus lässt sich
nichts über den Bestand ableiten.

Es wird **nichts zurückgesetzt.** Es entsteht ein Eintrag im Arbeitsvorrat der
IT (und, falls Jira konfiguriert ist, ein Ticket). Die IT prüft die Identität
ausserhalb des Portals und löst danach `reset_ad_password` aus — freigegeben
von einer zweiten Person.

## Anmeldung

| Methode | Pfad | Rolle | Zweck |
|---------|------|-------|-------|
| POST | `/api/auth/login` | user | Anmeldung bestätigen |
| GET | `/api/auth/me` | user | eigene Identität und Rolle |

`GET /api/config` nennt unter `mode` den aktiven Anmeldeweg: `entra`, `simple`
oder `off`. Siehe [CONFIGURATION.md](CONFIGURATION.md).

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
| GET | `/api/audit` | it | Audit-Log |

## Wissen und Tickets

| Methode | Pfad | Rolle | Zweck |
|---------|------|-------|-------|
| GET | `/api/knowledge?q=` | user | Confluence-Volltextsuche über CQL |
| POST | `/api/tickets` | user | Jira-Ticket anlegen (eines je Gespräch) |
| GET | `/api/tickets/:key` | it | Ticketstatus |

## Passwort-Hilfe

| Methode | Pfad | Rolle | Zweck |
|---------|------|-------|-------|
| POST | `/api/self-service/password-help` | user | derselbe Weg aus der angemeldeten Sitzung; die Kennung kommt aus der Sitzung, nicht aus dem Formular |
| GET | `/api/password-requests` | it | Arbeitsvorrat |
| POST | `/api/password-requests/:id/close` | it | Anfrage als erledigt markieren |

## Konten

| Methode | Pfad | Rolle | Zweck |
|---------|------|-------|-------|
| GET | `/api/entra/sspr?upn=` | it | SSPR-Triage über Microsoft Graph |

Liefert `isSsprEnabled`, `isSsprRegistered`, `isSsprCapable` und
`methodsRegistered`. Das Zurücksetzen selbst ist bewusst nicht implementiert —
siehe [`SECURITY.md`](SECURITY.md).

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
