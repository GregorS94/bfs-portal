# Stand

Letzte Aktualisierung: 2026-08-30.

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

**Passwort vergessen, ohne Anmeldung.** Am laufenden System durchgespielt:
Zwölf Anfragen von derselben Adresse ergaben genau fünf Einträge, alle zwölf
Antworten waren wortgleich — die Begrenzung greift, ohne sich zu verraten. Ein
formal ungültiger Anmeldename liefert 400, ein gültiger immer 202. Die IT sieht
den Arbeitsvorrat unter `/it`, „Erledigt" schreibt `password.help.closed` mit
der freigebenden Person ins Audit-Log. Zurückgesetzt wird dabei nichts.

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

**Konten.** Drei AD-Aktionen im Backend, 8 Prüfungen. Entra-Treiber für die
SSPR-Triage, 7 Prüfungen.

**Einstellungen über die Oberfläche.** 11 Prüfungen. Live gegengeprüft, dass
ein Token in keiner Antwort und in keinem Audit-Eintrag auftaucht.

**Vier-Augen bei Kontoaktionen.** `reset_ad_password` und `unlock_ad_account`
können nicht von der anfragenden Person freigegeben werden. 20 Prüfungen.

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
2. **AD-Aktionen sind weiterhin nicht auslösbar.** `reset_ad_password`,
   `unlock_ad_account` und `get_ad_account_status` sind definiert, geprüft und
   mit Vier-Augen belegt — aber `createJob()` wird nur aus dem Chat heraus
   aufgerufen, und dort sind sie mit `chat: false` ausgeschlossen. Die
   Passwort-Hilfe legt jetzt den Arbeitsvorrat an; was fehlt, ist der Knopf im
   IT-Bereich, der aus einer Anfrage den Auftrag macht. Erst damit läuft die
   Vier-Augen-Freigabe im laufenden Portal statt nur im Test.
3. **bConnect am echten Server prüfen.** Verifiziert ist nur gegen die
   Attrappe. Offen sind die Feldnamen der JobInstance-Zustände
   (`interpretState()`) und ob ein bMS-Job Rohausgabe liefert oder nur Status.
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
