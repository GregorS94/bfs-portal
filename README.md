# BFS Self-Service Portal

KI-gestützter 1st-Level-IT-Support: Mitarbeitende beschreiben ihr Problem im
Chat, das Modell stellt Diagnosen über einen Agenten auf dem betroffenen Gerät,
und ändernde Eingriffe laufen erst nach ausdrücklicher Freigabe in der
Oberfläche — jeder Schritt im Audit-Log.

> **Status: Prototyp, keine Produktivumgebung.** Läuft auf einem Raspberry Pi
> als Prüfstand. Hochverfügbarkeit, Alarmierung und Backups sind bewusst kein
> Ziel. Was verifiziert ist und was noch offen ist, steht in
> [`docs/STATUS.md`](docs/STATUS.md).

![Eine verändernde Aktion wartet auf Freigabe und läuft erst nach dem Klick](docs/demo/freigabe.gif)

<sub>Der ganze Kern in sieben Sekunden: Das Modell schlägt vor, ein Mensch gibt
frei, erst dann passiert etwas auf dem Gerät.</sub>

## Sechs Bilder, die das Portal erklären

Alle Aufnahmen stammen aus der laufenden Instanz, jede aus einem eigenen
Gespräch. Wer lieber zusieht: [**Aufzeichnung eines Durchlaufs**](docs/demo/bfs-portal-demo.mp4),
2:06, ohne Ton.

**1 — Das Modell sieht selbst nach.** „Wie voll ist meine Festplatte?" führt zu
einem Aufruf von `get_disk_space` auf dem Gerät. Die Zahlen sind gemessen, nicht
geschätzt; der graue Balken unter der Antwort zeigt, welche Aktion gelaufen ist.

![Diagnose: das Modell ruft get_disk_space auf dem Gerät auf](docs/screenshots/01-diagnose.png)

**2 — Verändernde Aktionen warten.** Die Bereinigung der Journal-Logs erzeugt
einen Auftrag im Zustand `awaiting_approval`. Der Befehl steht fest im Backend,
das Modell formuliert ihn nicht. Ohne Klick passiert nichts — und das Modell
sagt hier von sich aus, dass die Bereinigung gar nicht nötig ist.

![Freigabe erforderlich: clear_journal_logs wartet auf Bestätigung](docs/screenshots/02-freigabe.png)

**3 — Antworten statt Suchergebnisse.** Das Modell durchsucht Confluence, lädt
den Seitentext der besten Treffer nach und antwortet daraus — inklusive
Druckserver-Name aus der Anleitung.

![Wissensdatenbank: Antwort aus dem Confluence-Seitentext](docs/screenshots/03-wissen.png)

**4 — Wenn Software nicht hilft, entsteht ein Ticket.** Ein gebrochenes
Scharnier lässt sich nicht aus der Ferne reparieren. Statt zu raten, sucht das
Modell erst nach, legt dann selbst einen Jira-Vorgang an und nennt die Nummer.

![Eskalation: das Modell legt Ticket ITS-101 in Jira an](docs/screenshots/04-ticket.png)

**5 — Die Sicht des IT-Supports.** Offene Freigaben oben, darunter der Verlauf
aller Aufträge mit Gerät, Zeit und der Person, die freigegeben hat.

![IT-Support: offene Freigabe und Auftragsverlauf](docs/screenshots/05-auftraege.png)

**6 — Das Audit-Log.** Vom Backend geschrieben, nie vom Modell. Die Einträge
sind über Hashes verkettet: Wer nachträglich etwas ändert, bricht die Kette.

![Audit-Log: verkettete Einträge über Aufträge, Freigaben und Tickets](docs/screenshots/06-audit.png)

> In den Bildern 3 und 4 laufen Confluence und Jira gegen eine Attrappe
> (`tools/atlassian-mock.js`) — daher die Adresse `192.168.178.50:4600` in der
> Administrationsseite weiter unten. Eine echte Atlassian-Instanz ist noch nicht
> angebunden. Modell, Geräte-Agent, Freigabe und Audit-Log sind echt.

## Was die Bilder nicht zeigen

Oben steht der Weg, der funktioniert. Damit niemand den Prototyp für weiter
hält, als er ist — die vier Punkte, die zwischen „sieht gut aus" und „darüber
kann man entscheiden" liegen. Vollständig in [`docs/STATUS.md`](docs/STATUS.md).

- **Die Vier-Augen-Freigabe läuft nur im Test.** `reset_ad_password` und
  `unlock_ad_account` sind definiert, geprüft und mit Vier-Augen belegt — aber
  im Portal fehlt der Knopf, der aus einer Passwort-Anfrage einen Auftrag
  macht. Genau diese Kontrolle will eine Prüfung sehen.
- **Kein Zielsystem ist echt angebunden.** Entra, Jira, Confluence und
  baramundi bConnect sind Attrappen. Was am echten Server anders heisst, weiss
  bisher niemand.
- **Aufträge und Geräte liegen im Arbeitsspeicher** und sind nach einem
  Neustart des Backends weg. Nur das Audit-Log überlebt.
- **Die Windows-Varianten der Aktionen sind nie auf Windows gelaufen.**
  Getestet ist Linux, weil der Prüfstand ein Raspberry Pi ist.

Der längere Weg ist ohnehin nicht die Technik: BFS Abrechnung steht unter
BaFin-Aufsicht, damit hängen Auslagerungsmanagement, Vorfallmeldung,
Aufbewahrungsfristen und Mitbestimmung an einer produktiven Einführung.
Aufstellung samt Lückenliste in [`docs/PROZESSE.md`](docs/PROZESSE.md).

## Die Idee

Klassischer 1st-Level-Support besteht zu großen Teilen aus immer denselben
Handgriffen: Platte voll, Dienst hängt, Konto gesperrt, Passwort vergessen.
Das Portal lässt ein Sprachmodell diese Fälle aufnehmen, selbst nachsehen und
— nach Freigabe — selbst beheben.

Der Punkt ist nicht der Chat. Der Punkt ist, dass zwischen „das Modell schlägt
etwas vor" und „auf dem Rechner passiert etwas" zwei unabhängige Kontrollen
liegen, die das Modell nicht umgehen kann. Siehe
[`docs/SECURITY.md`](docs/SECURITY.md).

## Aufbau in einem Absatz

Ein React-Frontend (nginx) spricht mit einem Express-Backend, das den Chat per
SSE streamt und Anthropic Tool Use gegen eine **feste Liste von 11 Aktionen**
fährt. Lesende Aktionen laufen sofort, schreibende erzeugen einen Auftrag im
Zustand `awaiting_approval`. Ein Python-Agent auf dem Zielgerät holt sich
freigegebene Aufträge per Long-Polling ab und führt sie ohne Shell aus.
Dazu kommen Treiber für Confluence/Jira, Microsoft Graph und baramundi
bConnect. Details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

```
Browser ──► frontend (nginx :9000)
              └─► backend (Express :9001) ──► Anthropic API
                    ├─► Auftragswarteschlange ──► Agent auf dem Gerät
                    ├─► Confluence / Jira
                    ├─► Microsoft Graph
                    └─► baramundi bConnect
```

## Schnellstart

```bash
git clone <repo> bfs-portal && cd bfs-portal
cp .env.example .env          # ANTHROPIC_API_KEY und AGENT_TOKEN eintragen
docker compose up -d --build
```

Frontend http://localhost:9000, Backend http://localhost:9001,
Attrappen-API http://localhost:9002. Ohne Entra-Konfiguration meldet das
Portal einen Entwicklungs-Benutzer an. Vollständige Anleitung inklusive
Geräte-Agent: [`docs/SETUP.md`](docs/SETUP.md).

## Bereiche und Rollen

| Pfad | Bereich | Mindestrolle |
|------|---------|--------------|
| `/` | Mitarbeitende: Chat, eigene Freigaben, Passwort-Hilfe, Software | `user` |
| `/it` | IT-Support: Aufträge, Geräte, Passwort-Hilfe, Audit-Log, fremde Freigaben | `it` |
| `/admin` | Administration: Dienste-Status, Zugangsdaten | `admin` |

Rollen kommen aus Entra-App-Rollen (`portal.it`, `portal.admin`), ersatzweise
aus `ENTRA_IT_USERS` / `ENTRA_ADMIN_USERS`, ohne Entra aus `DEV_ROLE`.

## Anmelden — und der Fall, in dem das nicht geht

Es gibt drei Anmeldewege, immer genau einen: `entra` (Microsoft 365, geprüft),
`simple` (nur ein Name, **ungeprüft**, ausschliesslich für den Prototyp) und
`off` (fester Entwicklungs-Benutzer). Details in
[`docs/CONFIGURATION.md`](docs/CONFIGURATION.md).

Wer sein Passwort vergessen hat, kommt durch keinen dieser Wege — genau dann
braucht er das Portal aber. Deshalb liegt **„Passwort vergessen" vor der
Anmeldung**: Anmeldename eintragen, optional eine Rückrufnummer. Daraus wird
ein Eintrag im Arbeitsvorrat der IT und, wenn Jira konfiguriert ist, ein
Ticket.

Was dabei ausdrücklich **nicht** passiert: Es wird nichts zurückgesetzt und
nichts entsperrt. Die IT prüft die Identität ausserhalb des Portals — Rückruf,
Personalnummer, Ausweis — und löst danach `reset_ad_password` aus, das eine
zweite Person aus der IT freigeben muss. Die Antwort des offenen Endpunkts ist
immer dieselbe, auch bei unbekanntem Konto; sonst wäre er ein Verzeichnis
aller Anmeldenamen des Hauses.

![Administration: Dienste-Status und Zugangsdaten](docs/screenshots/07-administration.png)

Die Statusseite prüft alle Abhängigkeiten und aktualisiert sich alle 15
Sekunden. Zugangsdaten werden hier eingetragen statt in der `.env` —
hinterlegte Geheimnisse gehen nie an den Browser zurück, das Feld zeigt nur,
ob etwas gesetzt ist.

## Dokumentation

| Datei | Inhalt |
|-------|--------|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Komponenten, Datenfluss, Zustände eines Auftrags |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Freigabemodell, Bedrohungsmodell, bewusste Grenzen |
| [`docs/SETUP.md`](docs/SETUP.md) | Installation von null, Geräte-Agent, Entwicklungsmodus |
| [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) | Alle Umgebungsvariablen und Oberflächen-Einstellungen |
| [`docs/API.md`](docs/API.md) | Alle 23 Endpunkte mit Rollen |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | Tests, Attrappen, Statusprüfung, bekannte Fallstricke |
| [`docs/ENTRA_SETUP.md`](docs/ENTRA_SETUP.md) | App-Registrierung in Entra ID |
| [`docs/PROZESSE.md`](docs/PROZESSE.md) | Prozesse und aufsichtsrechtliche Einordnung (DORA, MaRisk, DSGVO, AI Act) |
| [`docs/STATUS.md`](docs/STATUS.md) | Was verifiziert ist, was offen ist |

## Tests

Die Treibertests laufen gegen Attrappen, nicht gegen echte Systeme — ein
Nachbau der Request-Formen genügt, um Filterlogik und Injektionsabwehr zu
prüfen.

```bash
for t in actions atlassian entra settings approval audit agents; do
  node tools/$t-test.js || break
done
```

102 Prüfungen, ohne Server und ohne installierte Abhängigkeiten. Was sie im
Einzelnen abdecken, steht in [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Lizenz

Kein Lizenzvermerk — internes Projekt, alle Rechte vorbehalten.
