# Architektur

## Komponenten

| Dienst | Technik | Port | Aufgabe |
|--------|---------|------|---------|
| `frontend` | React (kein Router), nginx | 9000 → 80 | Oberfläche, Statik, `/api`-Proxy |
| `backend` | Node/Express | 9001 → 3000 | Chat, Werkzeuge, Aufträge, Audit, Treiber |
| `mock-api` | Node | 9002 → 3002 | Attrappe für Fremdsysteme im Entwicklungsbetrieb |
| Agent | Python 3, nur Standardbibliothek | — | läuft auf dem Zielgerät, holt Aufträge ab |

Zustandsdaten liegen im Volume `audit_data` unter `/data`:
`audit.jsonl` (Audit-Log) und `settings.json` (über die Oberfläche gesetzte
Zugangsdaten, Rechte 0600).

## Warum der Agent zieht statt geschoben zu bekommen

Der Agent baut die Verbindung nach außen auf und fragt per Long-Polling nach
Arbeit. Das Backend braucht dadurch keinen Weg *in* das Client-Netz hinein —
kein offener Port, keine Firewall-Ausnahme auf dem Arbeitsplatzrechner. Der
Preis: der Agent muss sich zyklisch neu registrieren, sonst ist er nach einem
Backend-Neustart unsichtbar (Aufträge und Geräte liegen im RAM).

## Lebenszyklus eines Auftrags

```
                 lesende Aktion
Chat ──► Werkzeug ──────────────► local ──► done
             │
             │ schreibende Aktion
             ▼
      awaiting_approval ──► (Freigabe im UI) ──► queued
             │                                     │
             │ (Ablehnung)                         │ Agent holt ab
             ▼                                     ▼
          denied                              dispatched ──► done | error
```

Lesende Aktionen (`risk: 'read'`) laufen ohne Rückfrage. Alles Schreibende
hält bei `awaiting_approval` an, bis ein Mensch im UI zustimmt. Ein `user`
darf nur eigene Aufträge freigeben, `it` und `admin` auch fremde.

## Der Chat-Durchlauf

`POST /api/support/chat` streamt per SSE. Pro Zug:

1. `toolsFor(device)` stellt die Werkzeugliste zusammen — gerätebezogene
   Aktionen nur, wenn ein Gerät zugeordnet ist, dazu die gerätelosen
   `search_knowledge_base` und `create_ticket`, aber nur wenn Confluence bzw.
   Jira konfiguriert sind. Angeboten wird nur, was auch funktioniert; sonst
   schlägt das Modell Wege vor, die ins Leere laufen.
2. Modellaufruf mit `max_tokens: 8000`. Kommt ein `tool_use` zurück, führt das
   Backend die Aktion aus — oder legt einen Freigabe-Auftrag an.
3. Der Abschlussaufruf nach `tool_result`-Blöcken deklariert die Werkzeuge
   erneut, aber mit `tool_choice: { type: 'none' }`. Ohne `tools` liefert die
   API an dieser Stelle 0 Ausgabe-Token.

Verlauf über 20 Züge, Kosten rund 0,9 ct pro Gespräch.

### Werkzeuge, die das Modell nicht sieht

Die drei AD-Aktionen (`get_ad_account_status`, `unlock_ad_account`,
`reset_ad_password`) tragen `chat: false` und sind aus den Werkzeugdefinitionen
herausgefiltert. Sonst ginge ihre Ausgabe als `tool_result` zurück ins Modell,
und ein Einmal-Passwort stünde im Chatverlauf. Sie laufen ausschließlich über
die IT-Oberfläche.

## Aktionen

`backend/actions.js` definiert 11 Aktionen, jede mit `risk`, JSON-Schema für
die Eingabe und je einer Variante für Linux und Windows/PowerShell:

| Aktion | Risiko | Plattform |
|--------|--------|-----------|
| `get_disk_space`, `get_memory`, `get_uptime` | read | beide |
| `get_service_status`, `get_top_processes`, `get_failed_units` | read | beide |
| `restart_service`, `clear_journal_logs` | write | beide |
| `get_ad_account_status` | read | nur Windows |
| `unlock_ad_account`, `reset_ad_password` | write | nur Windows |

Die AD-Aktionen sind ohne Domäne sinnlos; unter Linux wirft `resolveCommand`.

## Treiber

| Datei | System | Besonderheit |
|-------|--------|--------------|
| `drivers/atlassian.js` | Confluence + Jira | ein Treiber für beide — Atlassian Cloud nutzt dieselbe Adresse und Anmeldung |
| `drivers/entra.js` | Microsoft Graph | nur SSPR-*Triage*; das Zurücksetzen selbst hat keine API |
| `drivers/bconnect.js` | baramundi bMC 26.1 | Jobs nur aus `BCONNECT_ALLOWED_JOBS` |

Treiber lesen ihre Konfiguration bei jedem Zugriff frisch aus `settings.js` —
eine Änderung in der Oberfläche wirkt ohne Neustart.

## Frontend ohne Router

`App.jsx` wählt den Bereich anhand von `location.pathname` und wechselt per
`history.pushState`. nginx liefert für unbekannte Pfade `index.html` aus
(SPA-Fallback). Das spart eine Abhängigkeit; der Preis ist, dass Navigation
von Hand verdrahtet ist.

`proxy_buffering off` in `nginx.conf` ist Pflicht — sonst hält nginx den
SSE-Strom zurück und der Chat erscheint erst am Ende komplett.
