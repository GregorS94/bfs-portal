# Prozesse und aufsichtsrechtliche Einordnung

Stand 2026-08-30.

**Was dieses Dokument ist:** die Prozesse, die um das Portal herum geregelt
sein müssen, bevor es mit echten Nutzerinnen und Nutzern laufen darf — und
eine ehrliche Aufstellung, was der heutige Stand davon schon erfüllt.

**Was es nicht ist:** eine Rechtsberatung. Geschrieben von jemandem, der die
Verordnungstexte liest, nicht von einem Juristen. Jeder mit „→ bestätigen"
markierte Punkt gehört über Compliance, Datenschutzbeauftragte und
Betriebsrat, bevor er als erledigt gilt.

**Geltungsrahmen heute:** Das Portal läuft als Prototyp auf einem privaten
Raspberry Pi, ohne echte Beschäftigtendaten. In diesem Zustand greift nichts
von dem Folgenden. Alles hier beschriebene ist Vorbereitung auf den Tag, an
dem es das erste Mal auf einen echten Arbeitsplatz zeigt.

## Was greift

BFS Abrechnung ist im Finanzsektor tätig und steht unter BaFin-Aufsicht.
Damit ist die Lage strenger als bei einem gewöhnlichen internen Werkzeug.

| Regelwerk | Betroffen | Was daraus folgt |
|-----------|-----------|------------------|
| **DORA** | → bestätigen | IKT-Risikomanagement, Vorfallmeldung, Register der IKT-Drittdienstleister, Vertragsanforderungen, Ausstiegsstrategie |
| **MaRisk / BAIT** (KWG § 25a) | ja, bei BaFin-Aufsicht | Auslagerungsmanagement, Berechtigungskonzept, Änderungsmanagement, Protokollierung |
| **DSGVO** | ja | AVV Art. 28, Drittlandtransfer, Löschkonzept, Verzeichnis der Verarbeitungstätigkeiten, DSFA prüfen (Art. 35) |
| **BetrVG § 87 Abs. 1 Nr. 6** | ja | Mitbestimmung, weil das Audit-Log zur Verhaltenskontrolle geeignet ist |
| **EU AI Act** | ja, Art. 50 + Art. 4 | Transparenz gegenüber Nutzern, KI-Kompetenz der Beschäftigten |
| **NIS2 / NIS2UmsuCG** | eher nicht | Für Finanzunternehmen gilt DORA als Lex specialis. → bestätigen |

**Zu bestätigen, bevor irgendetwas anderes Sinn ergibt:** ob DORA unmittelbar
greift, hängt an der konkreten Erlaubnis nach KWG. Die Liste der erfassten
Finanzunternehmen in DORA Art. 2 ist abschließend und deckt sich nicht
eins zu eins mit „von der BaFin beaufsichtigt". Fällt BFS Abrechnung nicht
darunter, bleiben MaRisk und BAIT — inhaltlich verlangen die in den hier
relevanten Punkten sehr Ähnliches. Die Prozesse unten sind deshalb so
geschrieben, dass sie in beiden Fällen tragen.

Für kleinere Unternehmen sieht DORA Art. 16 ein vereinfachtes Rahmenwerk vor.
→ prüfen, ob das anwendbar ist; es reduziert den Aufwand erheblich.

## Der Knackpunkt: Anthropic als IKT-Drittdienstleister

Das ist die Frage, an der dieses Projekt aufsichtsrechtlich hängt.

Jede Chatnachricht geht an einen US-amerikanischen Anbieter. Damit ist
Anthropic ein IKT-Drittdienstleister und gehört ins Register. Entscheidend
ist die Einstufung: Unterstützt das Portal eine **kritische oder wichtige
Funktion**?

- Argument dagegen: 1st-Level-IT-Support ist eine unterstützende Funktion.
  Fällt sie aus, arbeitet der Support wie bisher manuell weiter.
- Argument dafür: Das Portal kann über den Agenten in Systeme eingreifen und
  Konten entsperren.

Die Einstufung entscheidet über den Aufwand: Bei „kritisch oder wichtig"
gelten die verschärften Vertragsanforderungen aus DORA Art. 30 Abs. 3 —
Zugangs-, Inspektions- und Zugriffsrechte, Kündigungsrechte, Vorgaben zum
Ort der Datenverarbeitung. → durch Compliance entscheiden lassen.

**Praktische Empfehlung, unabhängig von der Einstufung:** Das Portal so
auslegen, dass der Ausfall des Modells den Support nicht blockiert. Fällt die
API aus, muss das Portal weiter erreichbar sein und Wissenssuche sowie
Ticketerstellung anbieten — dann bleibt die Funktion nicht-kritisch, und der
Nachweis dafür ist geführt.

### Register der IKT-Drittdienstleister

Vorlage für die Meldung; auszufüllen, sobald produktiv.

| Dienstleister | Leistung | Datenkategorien | Ort der Verarbeitung | Kritisch/wichtig | Vertrag |
|---------------|----------|-----------------|----------------------|------------------|---------|
| Anthropic | Sprachmodell für den Chat | Freitext der Anfragen, Gerätename, Kennung | USA | → einstufen | AVV + DORA-Klauseln nötig |
| Atlassian | Confluence, Jira | Ticketinhalte, Melder | EU/USA je nach Tarif | → einstufen | AVV prüfen |
| Microsoft | Entra ID, Graph | Anmeldedaten, UPN | EU | vorhanden | bestehender Vertrag prüfen |
| baramundi | Client-Management | Gerätedaten, Jobs | on premises | gering | intern |

## Die Prozesse

### P1 — Änderungsmanagement

*Weitgehend umgesetzt.*

Auslöser: jede Änderung an Code oder Konfiguration.

1. Änderung im Repository, nicht auf dem Zielsystem.
2. `scripts/check-drift.sh` — Abweichungen auf dem Host auflösen.
3. Tests: die vier Skripte unter `tools/`.
4. `scripts/deploy.sh` rollt aus und baut neu.
5. Commit mit nachvollziehbarer Begründung, danach `git push`.

Nachweis: Git-Historie. Sie belegt wer, wann, was und warum.

**Lücke:** Produktiv fehlt das Vier-Augen-Prinzip. Änderungen gehen heute
direkt auf `main`. → Pull Requests mit Freigabe durch eine zweite Person,
`main` schützen.

**Lücke:** Test- und Produktivumgebung sind nicht getrennt.

### P2 — Freigabe von Eingriffen

*Umgesetzt, das Kernstück des Produkts.*

Kein schreibender Eingriff läuft ohne menschliche Zustimmung. Auslöser ist
eine Aktion mit `risk: 'write'`; der Auftrag hält bei `awaiting_approval`, bis
jemand im UI zustimmt. `user` darf nur eigene Aufträge freigeben.

Nachweis: Audit-Log mit Auftrag, freigebender Person und Ergebnis.

Das erfüllt zugleich die menschliche Aufsicht über das KI-System.

**Lücke:** Für besonders eingriffsintensive Aktionen — Passwort zurücksetzen,
Konto entsperren — sollte die Freigabe durch eine **andere** Person als die
anfragende erfolgen. Heute kann ein `user` seinen eigenen Auftrag freigeben.

### P3 — Behandlung und Meldung von IKT-Vorfällen

*Nicht umgesetzt.*

Auslöser: Ausfall, Fehlverhalten oder Sicherheitsvorfall im Portal, beim
Agenten oder bei einem Drittdienstleister.

1. Erfassen und klassifizieren nach den DORA-Kriterien (betroffene Kunden,
   Dauer, Datenverlust, wirtschaftliche Auswirkung, geografische Ausbreitung).
2. Eindämmen, Ursache suchen, beheben.
3. Bei Einstufung als **schwerwiegend** an die BaFin melden:

| Meldung | Frist |
|---------|-------|
| Erstmeldung | 4 Stunden ab Klassifizierung als schwerwiegend, spätestens 24 Stunden ab Entdeckung |
| Zwischenmeldung | 72 Stunden nach der Erstmeldung |
| Abschlussmeldung | spätestens 1 Monat nach der Erstmeldung |

4. Bei Betroffenheit personenbezogener Daten zusätzlich DSGVO Art. 33: 72
   Stunden an die Aufsichtsbehörde.
5. Nachbereitung mit Ursachenanalyse und abgeleiteter Maßnahme.

**Zu klären:** Wer ist außerhalb der Geschäftszeiten erreichbar? Eine
Vier-Stunden-Frist ist ohne benannte Rufbereitschaft nicht haltbar.

Portal-spezifische Vorfälle, an die zu denken ist: Das Modell löst eine
unerwartete Aktion aus; ein Agent-Token wird kompromittiert; personenbezogene
Daten landen in einem Jira-Ticket, das `redact()` nicht erwischt hat.

### P4 — Berechtigungen

*Technisch umgesetzt, organisatorisch offen.*

Rollen `user` → `it` → `admin`, vergeben über Entra-App-Rollen
(`portal.it`, `portal.admin`). Die Notnägel `ENTRA_IT_USERS` und
`ENTRA_ADMIN_USERS` sind für den Produktivbetrieb ungeeignet — sie umgehen die
zentrale Rechteverwaltung.

**Lücken:**
- Kein turnusmäßiger Rezertifizierungslauf der Berechtigungen (BAIT verlangt
  eine regelmäßige Überprüfung).
- Kein definierter Prozess für den Entzug beim Austritt; hängt heute an der
  Entra-Gruppe, das ist bereits die richtige Stelle → als Prozess festhalten.
- Das Agent-Token ist ein einziges gemeinsames Geheimnis für alle Geräte, ohne
  Rotation und ohne Möglichkeit, ein einzelnes Gerät zu sperren.

### P5 — Protokollierung und Aufbewahrung

*Teilweise umgesetzt.*

Das Backend schreibt `/data/audit.jsonl` — nie das Modell. Erfasst werden
Auftragserstellung, Freigabe, Ergebnis, Ticketerstellung,
Einstellungsänderungen (nur Feldnamen, nie Werte).

**Lücken, alle vor dem Produktivbetrieb zu schließen:**
- **Keine Aufbewahrungs- und Löschfrist.** Das Log wächst unbegrenzt. Es
  enthält Personenbezug (wer hat wann was veranlasst), damit braucht es eine
  begründete Frist und ein automatisches Löschen. → Frist mit
  Datenschutzbeauftragten und Betriebsrat festlegen.
- **Kein Manipulationsschutz.** Wer Zugriff auf den Host hat, kann die Datei
  ändern. Für einen Nachweis gegenüber der Aufsicht zu wenig → Weiterleitung
  an ein zentrales, schreibgeschütztes Log-System.
- **Keine Sicherung.** Das Volume liegt auf einer SD-Karte.
- Zweckbindung: Das Log dient dem Nachweis, nicht der Leistungskontrolle. Das
  gehört ausdrücklich in die Betriebsvereinbarung.

### P6 — Auslagerung und Drittdienstleister

*Nicht umgesetzt.*

Für jeden Dienstleister aus dem Register:

1. Vorherige Risikoanalyse, Einstufung als kritisch/wichtig oder nicht.
2. Vertrag mit den nach DORA Art. 30 erforderlichen Klauseln, AVV nach DSGVO
   Art. 28, geregelter Drittlandtransfer.
3. Eintrag ins Register, jährliche Meldung an die Aufsicht.
4. Laufende Überwachung von Verfügbarkeit und Leistung.
5. **Ausstiegsstrategie**: Wie läuft der Support weiter, wenn der Anbieter
   ausfällt oder gekündigt wird? Beim Modell ist das vergleichsweise leicht —
   die Aufrufe sind an einer Stelle gekapselt und ein anderer Anbieter wäre
   austauschbar. Das ist ein Argument wert und gehört dokumentiert.

### P7 — Verfügbarkeit und Wiederanlauf

*Für den Prototyp bewusst nicht verfolgt, produktiv unverzichtbar.*

Zu klären: Wiederanlaufzeit und tolerierter Datenverlust, Sicherung von
Audit-Log und Einstellungen, dokumentierter Wiederanlauf, mindestens jährlicher
Test — DORA verlangt, dass Wiederherstellung nachweislich geübt wird.

Bekannte Schwächen des heutigen Aufbaus: Aufträge und Geräte liegen im RAM;
alles läuft auf einem Gerät; das System liegt auf einer SD-Karte.

### P8 — Betrieb des KI-Systems

*Teilweise umgesetzt.*

- **Transparenz** (AI Act Art. 50): Die Oberfläche muss erkennbar machen, dass
  hier eine KI antwortet. Heute ergibt sich das aus dem Kontext → ausdrücklich
  aufnehmen und dokumentieren.
- **Menschliche Aufsicht**: über das Freigabemodell gegeben, siehe P2.
- **Keine automatisierte Entscheidung mit Rechtsfolge** im Sinne von DSGVO
  Art. 22 — das Portal entscheidet nichts über Personen. Festhalten, weil die
  Frage kommen wird.
- **Modellwechsel** ist eine Änderung nach P1 und braucht einen erneuten
  Testlauf: Ein anderes Modell wählt Werkzeuge anders.
- **Grenzen der Eingabe**: `redact()` vor Jira ist eine Abwehr, keine
  Garantie. Nutzer müssen wissen, dass sie keine Passwörter in den Chat
  schreiben sollen.
- **Keine Nutzung der Daten zum Training** — vertraglich absichern.

## Was vor dem ersten echten Nutzer erledigt sein muss

Nach Aufwand geordnet, nicht nach Wichtigkeit — die ersten drei sind
organisatorisch und dauern am längsten, deshalb zuerst anstoßen.

1. Anwendbarkeit von DORA klären (Compliance).
2. Betriebsvereinbarung zum Audit-Log (Betriebsrat).
3. AVV und Drittlandtransfer mit Anthropic, DSFA prüfen (Datenschutz).
4. Aufbewahrungsfrist für das Audit-Log festlegen und technisch umsetzen.
5. Vier-Augen-Prinzip für Passwort- und Kontoaktionen.
6. Pull-Request-Pflicht auf `main`, Test- und Produktivumgebung trennen.
7. Audit-Log manipulationssicher auslagern und sichern.
8. Agent-Token je Gerät statt eines gemeinsamen Geheimnisses.
9. Vorfallprozess mit benannter Erreichbarkeit hinterlegen.
10. Wiederanlauf dokumentieren und einmal üben.

Punkt 5, 6, 7 und 8 sind Arbeit am Code und ließen sich hier erledigen. Alles
andere braucht Menschen mit Zuständigkeit.
