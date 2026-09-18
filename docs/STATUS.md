# Stand

Letzte Aktualisierung: 2026-09-17. Fahrplan: [`FAHRPLAN.md`](FAHRPLAN.md).

Prototyp und Entwicklungsumgebung, nichts Produktives. Hochverfügbarkeit,
Alarmierung und Backups sind bewusst kein Ziel. Fernziel ist ein
KI-gestützter 1st-Level-Support: Chat, Diagnose und Eingriffe im
Administratorkontext auf dem Client, jeweils mit Freigabe und Audit-Log.

Betrieben wird das Ganze auf einem Raspberry Pi 5, weil kein Windows-Rechner
zum Testen zur Verfügung steht. Das prägt einiges: die Linux-Varianten der
Aktionen sind erprobt, die PowerShell-Varianten sind es nicht.

## Fertig und verifiziert

**Chat.** Echter Claude-Chat über SSE, Verlauf über 20 Züge, rund 0,9 ct pro
Gespräch.

**Werkzeuge.** Tool Use gegen die feste Aktionsliste. Lesende Aktionen laufen
sofort mit echten Gerätedaten.

**Freigaben.** Schreibende Aktionen halten bei `awaiting_approval` an.
Ende zu Ende geprüft: Klick im UI → Exit 0 → das Journal auf dem Zielgerät
schrumpfte von 9,4 MB auf 8,0 MB.

**Zweiter Anmeldeweg (`simple`).** Geprüft: ohne Token 401, mit gültigem Token
die eigene Kennung, nach einem geänderten Zeichen im Token 401, Rolle `user`
bekommt auf der IT-Route 403 und eine Kennung aus `ENTRA_IT_USERS` die Rolle
`it`. Das Audit-Log führt `auth.simple.login` mit `verified: false`, die
Seitenleiste zeigt dauerhaft „Testbetrieb — Identität ungeprüft".

**Absicherung.** Zwei unabhängige Ebenen, im Test abgewiesen wurden `bash -c`,
`curl`, `systemctl mask` und ein Argument mit `;`. Details in
[`SECURITY.md`](SECURITY.md).

**Rollen und Bereiche.** `user` → `it` → `admin`, getrennte Bereiche `/`,
`/it`, `/admin`. Geprüft: als `user` liefern `/api/devices`, `/api/jobs` und
`/api/audit` 403, als `it`/`admin` 200.

**Entra-Anmeldung.** Code fertig. Geprüft in allen drei Zuständen: aus,
an ohne IDs (500 wie beabsichtigt), an mit IDs (401 ohne und bei ungültigem
Token). Fehlen nur die beiden IDs eines echten Mandanten.

**Atlassian.** Confluence-Suche und Jira-Ticket, 13 Prüfungen gegen die
Attrappe plus die echten Endpunkte im ausgerollten Container.

**Einstellungen über die Oberfläche.** 11 Prüfungen. Live gegengeprüft, dass
ein Token in keiner Antwort und in keinem Audit-Eintrag auftaucht.

**Vier-Augen für Aktionen an fremden Konten.** Die anfragende Person kann
einen solchen Auftrag nicht selbst freigeben. 17 Prüfungen. Seit dem
2026-09-17 nutzt keine ausgerollte Aktion die Regel mehr — sie wird mit einer
Prüfaktion belegt, damit sie beim nächsten Bedarf sofort greift.

**Audit-Log verkettet.** Jeder Eintrag trägt den Hash seines Vorgängers;
Änderungen und Löschungen werden sichtbar. Aufbewahrungsfrist über
`AUDIT_RETENTION_DAYS`, die Bereinigung protokolliert sich selbst. 18 Prüfungen,
dazu die Prüfung beim Start am laufenden System.

**Geräte-Token statt gemeinsamem Geheimnis.** Jedes Gerät hat ein eigenes,
gegen seine Kennung geprüftes Token; Sperren wirkt sofort und verhindert eine
erneute Anmeldung. 22 Prüfungen, dazu live auf dem Pi durchgespielt: Anmeldung,
Abweisung eines fremden Tokens, Sperren, Entsperren.

**Eskalation durch das Modell.** Am echten Modell durchgespielt, nicht nur im
Codepfad: „Display gesprungen" → Wissenssuche → `create_ticket` → Ticket
angelegt, Nummer in der Antwort genannt, Audit-Eintrag mit `viaChat: true`.

Dabei fiel auf, dass die Confluence-Suche nur Titel, Auszug und Link liefert —
nicht den Seiteninhalt. Das Modell konnte auf die richtige Seite zeigen, aber
nicht daraus antworten. Behoben: für die beiden vordersten Treffer wird der
Seitenkörper nachgeladen und aus dem XHTML Fließtext gemacht.

## Offen

1. **Zwei Entra-IDs** eines echten Mandanten — dann ist die Anmeldung scharf.
2. ~~AD-Aktionen sind nicht auslösbar.~~ **Entfallen.** Die Kontoaktionen und
   die Passwort-Hilfe sind am 2026-09-17 auf Gregors Entscheidung hin
   vollständig entfernt worden. Der Umfang ist jetzt Chat und Prüfung am
   Gerät; siehe [`FAHRPLAN.md`](FAHRPLAN.md).
3. **bConnect am echten Server prüfen.** Verifiziert ist nur gegen die
   Attrappe, inzwischen in beiden Fassungen (`node tools/bconnect-test.js`,
   37 Prüfungen). Die Schnittstellenfragen sind seit 2026-09-17 beantwortet —
   die Beschreibungen für bMS 26R1 liegen öffentlich vor: v2 läuft, alle drei
   Anmeldeverfahren werden angeboten, die Job-Zustände stehen jetzt wörtlich im
   Treiber, und eine JobInstance liefert **keine Rohausgabe**. Damit kann
   bConnect die Diagnosegruppe nicht übernehmen. Einzelheiten in
   [`docs/BARAMUNDI.md`](BARAMUNDI.md). Offen bleibt allein der erste Lauf
   gegen den echten Server — und der ist zurückgestellt, siehe
   [`FAHRPLAN.md`](FAHRPLAN.md).
4. **Software-Tab ist eine Attrappe.**
5. **Freigabe eines fremden Auftrags als `user`** ist am laufenden System
   ungeprüft — dafür braucht es zwei echte Identitäten. Die Regel selbst ist
   in `tools/approval-test.js` abgedeckt.
6. **Aufträge und Geräte liegen im RAM** und sind nach einem Backend-Neustart
   weg. Das Audit-Log überlebt.
7. **Die Windows-Varianten der Aktionen sind nie auf Windows gelaufen.**

## Vor einem Produktivbetrieb

BFS Abrechnung steht unter BaFin-Aufsicht. Damit hängt an einer produktiven
Einführung mehr als Technik: Auslagerungsmanagement, Vorfallmeldung,
Aufbewahrungsfristen, Mitbestimmung. Aufstellung samt Lückenliste in
[`PROZESSE.md`](PROZESSE.md).

## Bekannte Einschränkungen der Umgebung

Das System liegt auf einer SD-Karte, nicht auf einer SSD. Für einen Prototyp
in Ordnung, für Dauerbetrieb mit Schreiblast nicht.
