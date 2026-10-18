# Self-Support bei BFS Abrechnung — was davon wo hingehört

Stand 2026-09-23.

Es kursiert eine gängige Fünf-Punkte-Liste, was Unternehmen tun, um den
1st-Level-Support abzulösen: Chatbots, semantische Suche, Self-Service-Portal,
Kiosk-Hardware, proaktive Skripte. Die Liste ist richtig — und für eine
Entscheidung bei BFS unbrauchbar, solange niemand sie gegen den tatsächlichen
Bestand hält.

Genau das steht hier. Die Gliederung folgt der Liste; die Bewertung folgt dem,
was bei BFS vorhanden, gekauft oder schlicht nicht angebracht ist.

**Der wichtigste Befund vorweg:** Drei der fünf Punkte sind bei BFS bereits
gekauft oder vorhanden. Das Portal sollte nichts davon nachbauen. Sein Platz
ist schmal, aber es gibt ihn.

---

## 1. Chatbot und KI-Triage

**Das ist das Portal.** Chat gegen ein Sprachmodell, Werkzeugaufrufe gegen eine
feste Aktionsliste, Freigabe vor jedem Eingriff, verkettetes Audit-Log. Der
Teil ist gebaut und geprüft.

| Aus der Liste | Stand bei uns |
|---|---|
| Problem verstehen, Rückfragen stellen | da |
| Geführte Fehlerbehebung | da, im Gespräch |
| Ticket selbstständig anlegen | da (`create_ticket`, eines je Gespräch) |
| Vorkategorisieren für den 2nd Level | offen — Jira-Felder werden nicht gefüllt |
| Einbettung in Teams | **nicht gebaut**, eigene Weboberfläche |

**Die Teams-Frage ist die wichtigste offene an diesem Punkt.** Die Liste nennt
sie zu Recht zuerst: Ein Portal, das man aufrufen muss, verliert gegen ein
Fenster, das ohnehin offen ist. Wenn BFS Teams flächig nutzt, ist eine
Einbettung mehr wert als jede weitere Aktion im Portal.

## 2. Semantische Suche im Wissen

**Halb da.** `search_knowledge_base` sucht über CQL in Confluence und lädt für
die beiden vordersten Treffer den Seitentext nach — das Modell antwortet also
aus dem Inhalt, nicht nur mit einem Link. Das war eine bewusste Korrektur:
vorher zeigte es auf die richtige Seite, konnte aber nicht daraus antworten.

**Was fehlt, ist die Ablenkung vor dem Ticket** („Deflection"): Vorschläge
einblenden, *während* jemand ein Ticket tippt. Bei uns entsteht das Ticket im
Gespräch, der Effekt tritt also von selbst ein — aber nur für die, die den Chat
benutzen. Wer direkt in Jira geht, sieht nichts davon.

**Zu prüfen:** Atlassian bietet mit Rovo inzwischen eine eigene semantische
Suche über Confluence. Wenn die lizenziert ist, konkurriert sie mit unserem
Weg. Das gehört geklärt, bevor wir an der Suche weiterbauen — siehe die Notiz
zur Modellwahl in `PROZESSE.md`.

## 3. Self-Service-Portal und Servicekatalog

Hier liegt das meiste Missverständnis. Die Liste wirft drei sehr verschiedene
Dinge zusammen.

### Passwörter und gesperrte Konten

**Bewusst nicht im Portal** (Entscheidung vom 2026-09-17, siehe
[`FAHRPLAN.md`](FAHRPLAN.md)). Der Standardweg dafür heißt **Entra SSPR** —
Self-Service Password Reset, Teil von Entra ID, mit MFA-Nachweis über App oder
SMS. Das ist Microsofts eigener Weg, er ist geprüft, und er braucht kein
Portal, keinen Agenten und keine Freigabe von uns.

Wenn BFS Passwortrücksetzung selbstbedienbar machen will, ist **SSPR einzu­schalten
die richtige Antwort**, nicht ein Portal davorzubauen. Für Hybrid-Konten braucht
es dafür Password Writeback — das ist eine Lizenzfrage (Entra ID P1).

### Software auf Bestellung

**Habt ihr schon: der baramundi Kiosk.** Lizenziert (bestätigt 2026-09-18),
erreichbar unter `{Serveradresse}/bWebServer/Kiosk`. Anwender melden sich an
und weisen sich freigegebene Jobs selbst zu. Einzelheiten und die
Einrichtungsschritte in [`BARAMUNDI.md`](BARAMUNDI.md).

Das Portal müsste hier nichts nachbauen. Der einzige sinnvolle Beitrag wäre,
dass der Chat eine **Freigabe erteilt** (`POST /v2.0/KioskReleases`, zwei
Felder) — jemand fragt nach Software, das Portal gibt sie frei, der Mitarbeiter
holt sie im Kiosk. Das trennt Freigabe und Ausführung sauber, ohne dass das
Portal je etwas auf einem fremden Rechner ausführt.

**Genau das ist am 2026-10-18 gebaut worden** — als eigener Bereich und nicht
im Chat: Der Mitarbeiter sieht einen Katalog aus freigebbaren Jobs, fordert
einen an, die IT gibt frei, das Portal ruft dabei `POST /v2.0/KioskReleases`.
Installiert wird im Kiosk. Einen Softwarekatalog baut das Portal damit weiter
nicht nach; es verweist auf den vorhandenen. Stand und Grenzen in
[`BARAMUNDI.md`](BARAMUNDI.md).

### Hardware und Genehmigungen

**Nicht unser Feld.** Bestellstrecken mit Vorgesetztengenehmigung sind ein
Workflow-Thema; Jira Service Management kann das und ist vermutlich schon da.
Dort gehört es hin, nicht in ein Chatfenster.

## 4. Kiosk-Automaten und Schließfächer

**Nicht angebracht.** Das ist Hardware für Produktionsstandorte mit
Schichtbetrieb — Schließfächer, aus denen man sich um drei Uhr nachts eine Maus
zieht. BFS Abrechnung ist ein Bürobetrieb.

*Achtung, Wortgleichheit:* „Kiosk" meint in dieser Liste einen physischen
Automaten. Der **baramundi Kiosk** ist etwas völlig anderes — eine
Webanwendung. Die beiden nicht verwechseln, das führt in Gesprächen zuverlässig
zu Verwirrung.

## 5. Proaktiver Support

**Der interessanteste offene Punkt — und der heikelste.**

Technisch sind wir näher dran, als es aussieht. Der Geräte-Agent meldet sich
ohnehin alle vierzig Sekunden. Schickt er dabei einen Schwellwert mit — Platte
unter zehn Prozent —, kann das Portal von sich aus ein Ticket anlegen oder
aufräumen. Die Mechanik dafür steht zu drei Vierteln.

Was die Liste als Nexthink oder Tanium nennt, ist eine andere Größenordnung:
eigene Produkte mit eigener Lizenz, eigenem Rollout und eigener Datenhaltung.
Für einen Teil davon — Platte voll, Dienst hängt — reicht unser Agent.

**Aber:** Ein Dienst, der unaufgefordert auf Arbeitsplatzrechnern misst und
handelt, ist Verhaltenskontrolle im Sinne des Betriebsverfassungsgesetzes. Das
Audit-Log ist es ohnehin schon. **Der Betriebsrat gehört hier an den Anfang,
nicht ans Ende.** Wer proaktiv messen will, ohne das vorher geklärt zu haben,
baut etwas, das nicht in Betrieb gehen darf.

---

## Was daraus folgt

**Nicht bauen, weil vorhanden oder anderswo besser aufgehoben:**
Passwortrücksetzung (Entra SSPR), Softwarekatalog (baramundi Kiosk),
Hardwarebestellung (Jira Service Management), Kiosk-Automaten (nicht
angebracht).

**Das Portal hat einen schmalen, aber echten Platz:** das Gespräch, in dem
jemand sein Problem in eigenen Worten schildert, und die Diagnose am Gerät, die
daraus folgt. Das kann keines der obigen Systeme, und genau dort liegt der
aktuelle Umfang — acht Aktionen, Wissenssuche, Ticket.

**Die drei nächsten Schritte, nach Nutzen je Aufwand:**

1. **Windows-Gegenstück zu `clear_journal_logs`** — Temp, Papierkorb,
   Update-Cache. Ein Nachmittag, und es deckt vermutlich ein Drittel der
   Platte-voll-Fälle ohne einen Menschen ab.
2. **Teams-Einbettung prüfen.** Nicht bauen, erst prüfen: Wie nutzt BFS Teams,
   und was kostet eine Einbettung? Wenn das Portal dort sichtbar wird, steigt
   die Nutzung stärker als durch jede weitere Aktion.
3. **Betriebsrat ansprechen**, bevor irgendetwas proaktiv misst.

**Und eine Frage, die niemand technisch beantworten kann:** Wie viele Anrufe
gehen heute im 1st Level ein, und worum geht es dabei? Ohne diese Zahlen ist
jede Priorisierung geraten — auch diese hier. Eine Auswertung der Jira-Tickets
der letzten drei Monate nach Kategorie wäre die billigste und
aufschlussreichste Vorarbeit, die es gibt.
