# Fahrplan

Stand 2026-09-17. Der Zustandsbericht steht in [`STATUS.md`](STATUS.md); hier
steht, was in welcher Reihenfolge zu tun ist und **wer dafür gebraucht wird**.

Das ist die eigentliche Ordnung: nicht nach Aufwand, sondern danach, an wem ein
Schritt hängt. Was niemanden außer uns braucht, kommt zuerst.

---

## Stufe 0 — hängt an niemandem

### 0.1 Der fehlende Knopf im IT-Bereich

**Der wichtigste offene Punkt am Code.** `reset_ad_password`,
`unlock_ad_account` und `get_ad_account_status` sind definiert, geprüft und mit
Vier-Augen belegt — aber **nicht auslösbar**: `createJob()` wird nur aus dem
Chat gerufen, und dort sind die drei mit `chat: false` ausgeschlossen. Die
Passwort-Hilfe legt den Arbeitsvorrat an, was fehlt, ist der Knopf im
IT-Bereich, der aus einer Anfrage einen Auftrag macht.

Solange der fehlt, läuft die Vier-Augen-Freigabe nur im Test, nie im Portal.
Und ohne ihn ist Stufe 1 keine nutzbare Anwendung, sondern eine Chat-Oberfläche.

*Wer:* niemand außer uns. *Abhängig von:* nichts.

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

### 2.1 Ein Agent auf einem Domänenrechner

Für Kontosperre und Passwortrücksetzung. **Nicht auf den Arbeitsplätzen** —
`Get-ADUser` und `Unlock-ADAccount` brauchen irgendeinen Rechner in der Domäne
mit RSAT. Einer genügt.

Dabei zu klären: der Agent läuft als `SYSTEM`, also unter dem Computerkonto.
Das darf im AD lesen, aber weder entsperren noch Passwörter setzen. Es braucht
eine Delegation auf die betreffende OU oder ein eigenes Dienstkonto auf diesem
einen Rechner.

*Wer:* AD-Administration. *Abhängig von:* 0.1 und Stufe 1.

### 2.2 Diagnose auf den Arbeitsplätzen

Platte voll, Dienst hängt, Speicher knapp — dafür muss der Agent dort laufen,
wo der Anwender sitzt. Das ist der teure Teil: Verteilung, Token je Gerät,
`agent/install-windows.ps1`.

**Und hier ist bis heute nie etwas auf Windows gelaufen.** Die Linux-Varianten
sind erprobt, die PowerShell-Varianten nicht. Vor allem anderen gehört der
Agent einmal auf einen echten Windows-Rechner.

*Wer:* jemand mit einem Windows-Testrechner. *Abhängig von:* 2.1.

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
