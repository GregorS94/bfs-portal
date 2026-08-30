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

## Anmeldung

| Methode | Pfad | Rolle | Zweck |
|---------|------|-------|-------|
| POST | `/api/auth/login` | user | Anmeldung bestätigen |
| GET | `/api/auth/me` | user | eigene Identität und Rolle |

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

Ein leer gelassenes Geheimnisfeld bedeutet „nicht anfassen". Zum Entfernen
`null` senden.

## Agent

Eigener Token im `Authorization: Bearer`-Kopf, nicht Entra.

| Methode | Pfad | Zweck |
|---------|------|-------|
| POST | `/api/agent/register` | Gerät anmelden, zyklisch wiederholt |
| GET | `/api/agent/jobs?deviceId=` | Long-Poll auf freigegebene Aufträge |
| POST | `/api/agent/jobs/:id/result` | Ergebnis zurückmelden |

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
