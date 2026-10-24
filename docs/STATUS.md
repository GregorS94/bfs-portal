# Stand

Letzte Aktualisierung: 2026-10-24. Fahrplan: [`FAHRPLAN.md`](FAHRPLAN.md).

Prototyp und Entwicklungsumgebung, nichts Produktives. Hochverfügbarkeit,
Alarmierung und Backups sind bewusst kein Ziel. Fernziel ist ein
KI-gestützter 1st-Level-Support: Chat, Diagnose und Eingriffe im
Administratorkontext auf dem Client, jeweils mit Freigabe und Audit-Log.

Betrieben wird das Ganze auf einem Raspberry Pi 5, weil kein Windows-Rechner
zum Testen zur Verfügung steht. Das prägt einiges: die Linux-Varianten der
Aktionen sind erprobt, die PowerShell-Varianten sind es nicht.

## Umstellung auf Copilot Studio (2026-10-24)

Das Gespräch läuft künftig in Microsoft Teams über einen Agenten in Copilot
Studio; das Backend ist eine REST-API ohne Modell. Umgesetzt und geprüft:

* Vier Endpunkte `/api/bot/diagnose|approve|status|ticket`, eigenes
  Dienst-Token (`BOT_API_TOKEN`), Adaptive Cards in jeder Antwort.
* Die Freigabe läuft über dieselbe `decisionProblem()`-Prüfung wie das Portal;
  der Bot gilt als Rolle `user`, Vier-Augen-Aktionen sind über Teams nicht
  freigebbar.
* Auswertung der Messausgaben (`backend/diagnose.js`): `df`, `free`,
  `Get-PSDrive`, `Win32_OperatingSystem`. Nicht lesbare Ausgabe ergibt
  `unknown` und keine Zahl.
* `tools/bot-test.js` (69 Prüfungen, echtes HTTP) und
  `tools/diagnose-test.js` (34 Prüfungen).
* Der Chat im Portal ist abgeschaltet (`CHAT_ENABLED=false`) und bleibt als
  Vorführweg ohne M365-Tenant im Code. Ohne ihn braucht das Backend keinen
  `ANTHROPIC_API_KEY` mehr — der Client entsteht erst beim ersten Aufruf.

**Nie gegen Microsoft gelaufen.** Es gibt keinen M365-Tenant im Prüfstand.
Topics, HTTP Actions, Manifest und Teams-Ausrollung sind nach der
Dokumentation beschrieben ([`COPILOT_STUDIO.md`](COPILOT_STUDIO.md)), nicht
erprobt. Geprüft ist allein die Seite, die hier liegt: die REST-API.

## Fertig und verifiziert

**Chat.** Echter Claude-Chat über SSE, Verlauf über 20 Züge, rund 0,9 ct pro
Gespräch. Seit 2026-10-24 abgeschaltet, siehe oben.

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

**Lokale Konten mit Passwort (`local`).** Dritter Anmeldeweg, seit 2026-10-18:
Konto und Passwort aus einer Postgres-Tabelle, scrypt-gehasht, Rolle bei jeder
Anfrage frisch aus der Datenbank. Dazu die Kontenverwaltung in der
Administration — anlegen, Rolle ändern, sperren, Passwort setzen, löschen — und
ein Dialog fürs eigene Passwort. Ausgeliefert wird `admin/admin` und
`user/1234`; beide sind als „muss geändert werden" markiert. 52 Prüfungen ohne
Datenbank (`tools/accounts-test.js`) und 39 gegen einen echten Postgres im
ausgerollten Container (`tools/db-test.js`). Dazu am laufenden System
durchgespielt: Anmeldung, falsches Passwort (gleiche Meldung wie bei
unbekanntem Konto), Sperre nach fünf Fehlversuchen, Rollenentzug wirkt ohne
neues Anmelden, gesperrtes Konto fliegt sofort aus der Sitzung, und die drei
Selbst-Aussperr-Fälle werden abgewiesen. Was dabei auffiel und behoben ist: ein gekürzter
Passworthash hätte weiter gepasst, weil die Ausgabe von PBKDF2 präfixstabil
ist — siehe [`SECURITY.md`](SECURITY.md#der-modus-local-authentifiziert--gegen-das-portal).

**Datenbank.** Postgres 16 als Container ohne Port nach außen, Volume
`db_data`. Trägt die Konten und die Kiosk-Anforderungen; alles andere liegt
weiter in Dateien oder im RAM. Fällt sie aus, antwortet der lokale Anmeldeweg
mit 503 statt jemanden durchzulassen.

**Kiosk-Bereich.** Der Reiter „Software" war eine Attrappe (er rief eine Route
auf, die es nie gab) und ist jetzt der echte Weg: anfordern → die IT gibt frei
→ im baramundi Kiosk abholen. Freigegeben wird mit `POST /v2.0/KioskReleases`,
zurückgezogen mit `DELETE`; beide Formen stehen wörtlich in der
Schnittstellenbeschreibung. Das Portal führt dabei **nichts** aus. 15 Prüfungen
gegen die Attrappe, der Ablauf gegen Postgres. Einzelheiten und Grenzen in
[`BARAMUNDI.md`](BARAMUNDI.md).

**Audit-Log in der Oberfläche.** Eine Fassung für IT und Administration statt
zwei Abschriften, mit Filter, wählbarer Länge und — nur für Administratoren —
dem Zustand der Hash-Kette.

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
4. ~~Software-Tab ist eine Attrappe.~~ **Entfallen am 2026-10-18** — ersetzt
   durch den Kiosk-Bereich. Offen bleibt der erste Lauf gegen einen echten
   bMS-Server und die Frage, ob die Kiosk-Schnittstelle dort überhaupt
   eingeschaltet ist.
5. **Freigabe eines fremden Auftrags als `user`** ist am laufenden System
   ungeprüft — dafür braucht es zwei echte Identitäten. Die Regel selbst ist
   in `tools/approval-test.js` abgedeckt.
6. **Aufträge und Geräte liegen im RAM** und sind nach einem Backend-Neustart
   weg. Audit-Log, Konten und Kiosk-Anforderungen überleben.
7. **Die Windows-Varianten der Aktionen sind nie auf Windows gelaufen.**
8. **Die Leseendpunkte des Kiosk sind nicht umgesetzt**, weil ihre Pfade nicht
   wörtlich vorliegen. Das Zuweisungsziel trägt deshalb die IT bei der Freigabe
   ein, statt dass das Portal es aus dem Anmeldenamen ableitet.
9. **Der lokale Anmeldeweg prüft gegen das Portal, nicht gegen das AD.** Für
   den Echtbetrieb bleibt Entra der einzige zulässige Weg; `local` ist der
   bequeme Weg für Vorführung und Entwicklung ohne Mandanten.
10. **Die Bot-API weist den Dienst aus, nicht die Person.** Wer
    `BOT_API_TOKEN` hat, kann als jede `userId` auftreten. Deshalb darf
    `/api/bot/*` nicht öffentlich erreichbar sein. Zielbild: Entra-Token der
    Managed Identity prüfen und die `userId` aus dessen Ansprüchen nehmen.
11. **Die Gerätezuordnung fehlt.** Ohne `deviceId` nimmt das Portal das Gerät,
    das sich meldet — im Prototyp eindeutig, im Betrieb nicht. Person → Gerät
    muss aus Entra oder baramundi kommen.
12. **Ein übergebener Auftrag kommt nicht in die Warteschlange zurück.** Geht
    die Antwort des Agenten verloren, bleibt der Auftrag auf `dispatched`
    stehen (`dispatch()` in `backend/jobs.js`). Vorbestehend, fällt über Teams
    aber eher auf, weil die Diagnose nach 12 s antworten muss.
13. **Copilot Studio ist aufsichtsrechtlich nicht eingetragen.** Als IKT-
    Drittdienstleister gehört es ins DORA-Auslagerungsregister, die
    Datenschutz-Folgeabschätzung ist fortzuschreiben, der Betriebsrat bleibt
    wegen des Audit-Logs zu beteiligen ([`PROZESSE.md`](PROZESSE.md)).

## Vor einem Produktivbetrieb

BFS Abrechnung steht unter BaFin-Aufsicht. Damit hängt an einer produktiven
Einführung mehr als Technik: Auslagerungsmanagement, Vorfallmeldung,
Aufbewahrungsfristen, Mitbestimmung. Aufstellung samt Lückenliste in
[`PROZESSE.md`](PROZESSE.md).

## Bekannte Einschränkungen der Umgebung

Das System liegt auf einer SD-Karte, nicht auf einer SSD. Für einen Prototyp
in Ordnung, für Dauerbetrieb mit Schreiblast nicht.
