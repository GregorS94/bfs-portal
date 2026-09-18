# Fahrplan

Stand 2026-09-18. Der Zustandsbericht steht in [`STATUS.md`](STATUS.md); hier
steht, was in welcher Reihenfolge zu tun ist und **wer dafür gebraucht wird**.

Das ist die eigentliche Ordnung: nicht nach Aufwand, sondern danach, an wem ein
Schritt hängt. Was niemanden außer uns braucht, kommt zuerst.

---

## Stufe 0 — hängt an niemandem

### 0.1 ~~Der fehlende Knopf im IT-Bereich~~ — erledigt durch Streichung

Am 2026-09-18 anders gelöst als geplant: Die Kontoaktionen und die
Passwort-Hilfe sind **aus dem Umfang genommen** worden. Damit entfällt der
Knopf, statt gebaut zu werden.

**Der Umfang ist jetzt: Chat und Prüfung am Gerät.** Acht Aktionen
(sechs lesende Diagnosen, `restart_service`, `clear_journal_logs`), dazu
Wissenssuche und Ticket über Atlassian.

Entfernt wurden: die drei AD-Kontoaktionen, die öffentliche Passwort-Hilfe
samt Arbeitsvorrat und Begrenzung, der Microsoft-Graph-Treiber für die
SSPR-Triage und die zugehörigen Oberflächen. Die Vier-Augen-Regel in
`approval.js` **bleibt** — sie ist die sicherheitsrelevanteste Entscheidung im
Portal und wird mit einer Prüfaktion belegt, damit sie beim nächsten Einbau
einer Aktion für fremde Konten sofort greift.

### 0.2 Portal auf SRV-SSP01

Nach [`INSTALL_UBUNTU.md`](INSTALL_UBUNTU.md). Ohne Entra meldet das Portal
einen Entwicklungs-Benutzer an, es ist also sofort bedienbar — auch bevor
irgendein Fremdsystem angebunden ist.

Reihenfolge beachten: die Docker-Adressbereiche gehören **vor** den ersten
`docker compose up`.

*Wer:* Gregor. *Abhängig von:* nichts. *Dauer:* ein bis zwei Stunden.

### 0.3 Persistenz für Aufträge und Geräte

Beides liegt im RAM und ist nach einem Backend-Neustart weg (das Audit-Log
überlebt). Für einen Prototyp hinnehmbar, für etwas, das jemand benutzt, nicht:
ein Neustart während einer laufenden Freigabe verliert den Auftrag.

*Wer:* niemand außer uns. *Abhängig von:* nichts.

---

## Stufe 1 — nutzbar für die IT

Ab hier hängt jeder Punkt an einer Freigabe. Sie sind **unabhängig
voneinander** — was zuerst kommt, kann zuerst gemacht werden.

| Was | Wer wird gebraucht | Ergebnis |
|---|---|---|
| Ausgehend HTTPS zu `api.anthropic.com` | Netzwerk | Chat antwortet überhaupt |
| Atlassian-Token, Space-Keys, Jira-Projekt | Atlassian-Administration | Wissenssuche und Ticket |
| Zwei Entra-IDs eines echten Mandanten | Entra-Administration | echte Anmeldung statt Entwicklungs-Benutzer |
| Sophos: Clientnetz → SRV-SSP01 auf 9000/9001 | Netzwerk | Portal aus dem Clientnetz erreichbar |
| Reverse Proxy mit Zertifikat | Netzwerk | kein Klartext-HTTP |

Atlassian und Graph lassen sich über die Administrationsseite setzen, samt
Probelauf-Knopf gegen das echte System. Entra und bConnect **nur** über die
`.env`.

Zur Sophos: keine TLS-Inspection auf diesen Regeln, sonst bricht das Streaming
der Chat-Antwort. Einzelheiten in [`INSTALL_UBUNTU.md`](INSTALL_UBUNTU.md),
Schritt 11.

---

## Stufe 2 — Zugriff auf Geräte

### 2.1 Der Agent auf einem echten Windows-Rechner

Das ist jetzt der einzige Punkt in Stufe 2 — und der größte ungedeckte des
ganzen Projekts: **es ist nie etwas auf Windows gelaufen.** Die Linux-Varianten
der acht Aktionen sind erprobt, die PowerShell-Varianten nicht. Ungeprüft ist
insbesondere die Argumentübergabe: der Agent gibt Parameter als eigene
argv-Elemente weiter (`$args[0]`), nie im Skripttext. Ob das unter Windows über
`CreateProcess` so ankommt, wie es soll, lässt sich nur dort feststellen.

Ein einzelner Testrechner genügt dafür. Erst danach lohnt die Verteilung in die
Fläche mit `agent/install-windows.ps1`, Token je Gerät und allem, was daran
hängt.

**Der Agent läuft mit Systemrechten.** Das ist der Sinn der Übung — Diagnose
und Reparatur brauchen sie. Die Absicherung liegt deshalb vollständig in der
Freigabeliste, nicht in den Rechten des Prozesses: der Agent vergleicht jeden
PowerShell-Skripttext Zeichen für Zeichen mit seiner eigenen Liste und
vertraut dem Portal ausdrücklich nicht. `tools/agent-allowlist-test.js` hält
beide Listen im Abgleich.

*Wer:* jemand mit einem Windows-Testrechner. *Abhängig von:* Stufe 1.

---

## Stufe 3 — vor einem Produktivbetrieb

BFS Abrechnung steht unter BaFin-Aufsicht, damit hängt an einer Einführung mehr
als Technik. Aufstellung und Lückenliste in [`PROZESSE.md`](PROZESSE.md).

Zwei Punkte sind sofort greifbar:

- **`AUDIT_RETENTION_DAYS` als Zahl.** Ohne Frist wächst das Audit-Log
  unbegrenzt und enthält dabei Personenbezug. Welche Frist angemessen ist,
  gehört mit Datenschutz und Betriebsrat geklärt — das ist kein technischer
  Wert, sondern eine Festlegung.
- **Das Audit-Log ist Verhaltenskontrolle.** Damit ist der Betriebsrat zu
  beteiligen, bevor das Portal jemand außerhalb der IT benutzt. Früh ansprechen,
  nicht am Schluss.

---

## Zurückgestellt

**bConnect.** Der Treiber ist fertig und die Schnittstellenfragen sind seit
2026-09-17 beantwortet ([`BARAMUNDI.md`](BARAMUNDI.md)). Trotzdem
zurückgestellt, aus einem sachlichen Grund: **eine JobInstance liefert keine
Rohausgabe.** bConnect kann die Diagnosegruppe nicht übernehmen, und die
Kontogruppe auch nicht — der Kontext `Active Directory` ist rein lesend. Es
bliebe das Auslösen freigegebener Jobs, und dafür lohnt die Kette aus
API-Benutzer, Job-Freigaben und Firewall-Regel derzeit nicht.

Wieder aufnehmen, sobald Stufe 2 steht und klar ist, welche Jobs überhaupt aus
dem Portal heraus sinnvoll sind.

**Der MCP-Server von baramundi.** Reicht dem Modell 212 Werkzeuge direkt, an
Freigabeliste und Audit-Log vorbei. Das ist genau die Grenze, auf der dieses
Portal aufgebaut ist. Als Quelle war das Repository wertvoll, als Anbindung
wäre es ein Rückschritt.

**Desktop-App (Tauri).** Gerüst steht, nie gebaut. Zweitrangig, solange das
Portal im Browser läuft.
