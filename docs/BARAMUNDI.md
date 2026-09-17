# baramundi bConnect: was steht, was fehlt

Stand 2026-09-06. bConnect ist laut Gregor bei BFS lizenziert. Diese Seite hält
fest, was im Portal davon schon gebaut ist und was der Weg über baramundi am
eigenen Agenten ändern würde.

## Was schon steht

`backend/drivers/bconnect.js` ist vollständig da. Die Request-Formen stammen
aus dem Herstellermodul
[PS-bConnect](https://github.com/baramundisoftware/PS-bConnect), nicht aus
Vermutungen: Basic-Auth gegen
`https://{server}:{port}/bConnect/{version}/{Controller}`, Controller
`Endpoints`, `Jobs`, `JobInstances`.

Der Treiber kann:

- **Geräte auflisten** (`listDevices`) aus `Endpoints`
- **freigegebene Jobs auflisten** (`listJobs`) — gefiltert gegen
  `BCONNECT_ALLOWED_JOBS`
- **einen Job ausführen** (`run_bms_job`): Instanz anlegen, starten, alle fünf
  Sekunden den Status abfragen, bis zu zehn Minuten warten

Die Absicherung sitzt an drei Stellen: die Umgebungsvariable begrenzt den
Katalog, das Werkzeugschema führt die erlaubten Namen als `enum`, und `execute`
prüft den Namen noch einmal gegen die Liste. Ohne `BCONNECT_ALLOWED_JOBS` ist
nichts ausführbar — der bMS-Katalog enthält auch Rollouts und
Compliance-Läufe, die nicht in ein Chatfenster gehören.

**Ungetestet gegen einen echten Server.** Verifiziert ist nur gegen
`tools/bconnect-mock.js`. Offen sind die Feldnamen der JobInstance-Zustände in
`interpretState()` und ob ein bMS-Job Rohausgabe zurückliefert oder nur einen
Status (siehe `docs/STATUS.md`, Punkt 3).

## bConnect v2 — der Treiber spricht die alte Fassung

Es gibt inzwischen eine zweite Fassung der Schnittstelle. Das zugehörige
PowerShell-Modul
([bConnectV2](https://www.powershellgallery.com/packages/bConnectV2), Version
26.1.101) ist öffentlich; die folgenden Angaben stammen aus seinem Quelltext,
nicht aus Vermutungen.

**Adressen.** Basis ist `https://{host}[:port]/bconnect/{bereich}`, darunter
`/v2.0/…`. Der Bereich ist der Modulname in Kleinbuchstaben — `jobs`,
`endpoints`, `software`, `activedirectory`. Ein Aufruf sieht also so aus:
`https://bserver:8443/bconnect/jobs/v2.0/JobInstances`.

**Anmeldung.** `Authorization: Basic …` **oder** `X-API-KEY: …`
(`Private/Add-SecurityHeader.ps1`). Der API-Schlüssel ist der bessere Weg: Der
Treiber schickt heute bei jedem Aufruf Benutzername und Passwort eines
Dienstkontos mit.

**Jobs.** Saubere Pfade statt der Umwege von v1:

    POST /v2.0/JobInstances
    GET  /v2.0/JobInstances/{id}
    POST /v2.0/JobInstances/{id}/Start
    POST /v2.0/JobInstances/{id}/Stop
    POST /v2.0/JobInstances/{id}/Resume
    GET  /v2.0/Endpoints/{endpointId}/JobInstances

In v1 wird eine Instanz per `GET` angelegt — so macht es das Herstellermodul,
und so steht es auch in unserem Treiber. In v2 entfällt diese Kuriosität.

**Zwei Dinge, die neu interessant sind:**

- `Get-bCSoftwareInstalledWindowsSoftwareByEndpointId` — installierte Software
  je Gerät. Für ein Supportgespräch („welche Version hast du?") direkt
  brauchbar, ohne einen Job auszulösen.
- **Kiosk-Freigaben** (`New-bCJobsKioskRelease`,
  `Get-bCJobsKioskReleasesByEndpointId`). Laut Modulbeschreibung entstehen
  JobInstances auch dann, wenn ein Anwender sie über den baramundi Kiosk
  anfordert — vorausgesetzt, ein Administrator hat die Jobdefinition für ihn
  freigegeben. Damit gäbe es einen zweiten Weg für Softwarewünsche: Das Portal
  **gibt frei**, statt selbst zu installieren, und der Mitarbeiter holt sich
  die Software im Kiosk. Freigabe und Ausführung wären damit sauber getrennt.

**Was auch v2 nicht liefert:** keine Endpunkte für Plattenplatz, Speicher oder
Dienstzustände. Die Live-Diagnose bleibt also beim PowerShell-Job.

**Umgesetzt am 2026-09-06:** Der Treiber spricht beide Fassungen,
`BCONNECT_VERSION` entscheidet; **v2.0 ist die Vorgabe**, weil BFS auf bMC 26.1
ist. v2 nimmt `BCONNECT_API_KEY` und legt Instanzen per `POST` an; v1 bleibt
unverändert erreichbar. Dazu gibt es das lesende Werkzeug
`list_installed_software` — es beantwortet „welche Version hast du", ohne einen
Job auszulösen, und hängt nicht an der Job-Freigabeliste.

Geprüft mit `node tools/bconnect-test.js` (30 Prüfungen über v1, v2 mit
Schlüssel und v2 mit Basic) — gegen die Attrappe, nicht gegen einen echten
Server. Die Feldnamen der Softwareliste sind im Herstellermodul nicht
modelliert; der Treiber fragt mehrere Kandidaten ab und muss am echten Server
nachgeschärft werden.

## Was die Herstellerdokumentation klärt (Stand 2026-09-17)

Aus der bMC-Hilfe, Konfiguration → Schnittstellen → bConnect:

- **v2 ab bMS 2023 R1**, und sie braucht **keine eigene Konfiguration**. Sie ist
  da, sobald bConnect überhaupt aktiv ist. Damit ist die erste offene Frage
  beantwortet: BFS fährt bMC 26.1, v2 ist vorhanden.
- **Aktivieren im bMC** unter *Konfiguration → Schnittstellen*, dort bConnect auf
  *aktiv*.
- **Es gibt eine OpenAPI-Dokumentationsseite im Browser:**
  `https://<Server-FQDN>/bconnect/docs/`, erreichbar auch über *Öffnen* in
  derselben Maske. Pro Kontext liegt dort eine maschinenlesbare
  Schnittstellenbeschreibung.
- Was v1 angeht, liegt die ausführliche Fassung als PDF im Installationspfad
  unter `<Pfad zur bMS>\baramundi\Documentation\API`.
- Die Struktur heißt herstellerseitig **Kontext**, nicht Bereich — inhaltlich
  dasselbe wie der `{bereich}` in unseren Pfaden.
- **Content-Type mit Zeichensatz.** Die Dokumentation verlangt ausdrücklich
  `charset=utf-8` bei POST, sonst kommen Sonderzeichen falsch an. Der Treiber
  setzt das seit 2026-09-17; vorher stand dort nur `application/json`.

**Diese Doku-Seite ist der kürzeste Weg zu den offenen Fragen.** Zustandsnamen
einer JobInstance und Feldnamen der Softwareliste stehen im Schema — sie müssen
nicht am laufenden System erraten werden. Die Beschreibung für den Kontext
`jobs` herunterladen und gegen `interpretState()` legen, dann ist Punkt 3 der
Fragenliste erledigt, ohne einen einzigen Job auszulösen.

## Was die laufende Instanz sagt (Stand 2026-09-17)

Gregor hat die Doku-Seite `/bconnect/docs` des BFS-Servers als Webarchiv
geschickt. Damit ist einiges nicht mehr Vermutung:

- **bMS 26.1.9.0**, bConnect v2 **ist aktiv** und über `https://<FQDN>/bconnect/…`
  erreichbar. Kein abweichender Port, also 443 — die Vorgabe im Treiber stimmt.
- **Alle drei Anmeldeverfahren werden angeboten:** Windows, Basic *und* API Key.
  Damit ist die Sorge von vorhin ausgeräumt: `X-API-KEY` trägt, der Treiber passt
  in seiner heutigen Form. Es braucht kein Kerberos.
- **Zwölf Kontexte:** Active Directory, Assets, Compliance, Defense Control,
  Endpoints, Jobs, Operating Systems, Server Management, Software, Universal
  Dynamic Groups, Update Management, Variables.
- Die Schnittstellenbeschreibungen liegen unter einem festen Muster:

      https://<FQDN>/bconnect/<kontext>/openAPI/v2.0/bConnect_<Kontext>.json

  also etwa `…/bconnect/jobs/openAPI/v2.0/bConnect_Jobs.json`. Der Kontext im
  Pfad ist kleingeschrieben und ohne Trennzeichen (`activedirectory`,
  `defensecontrol`, `updatemanagement`).
- PATCH-Operationen arbeiten mit `JsonPatchDocument`, brauchen also den
  Patch-Content-Type. Der Treiber schickt heute kein PATCH.

**Der interessanteste Fund ist der Kontext `Active Directory`.** Kann bConnect
Konten entsperren und Passwörter setzen, dann ist die dritte Aktionsgruppe ohne
einen einzigen Agenten erreichbar — und Stufe 1 bräuchte gar keinen Agenten
mehr. Das steht und fällt mit `bConnect_ActiveDirectory.json`; die Datei liegt
noch nicht vor, und ohne sie ist das eine Hoffnung, keine Aussage.

Der konkrete Hostname steht bewusst nicht hier, sondern gehört in die `.env`.

## Die Lücke zum eigenen Agenten

Die Aktionen in `backend/actions.js` zerfallen in drei Gruppen:

| Gruppe | Beispiele | Läuft heute über |
|---|---|---|
| Diagnose am Gerät | `get_disk_space`, `get_memory`, `get_service_status`, `get_top_processes`, `get_failed_units` | eigener Agent |
| Eingriff am Gerät | `restart_service`, `clear_journal_logs` | eigener Agent |
| Verzeichnisdienst | `get_ad_account_status`, `unlock_ad_account`, `reset_ad_password` | eigener Agent auf **einem** Domänenrechner |

bConnect deckt heute nur die zweite Gruppe ab, und zwar als Job. Die dritte
bleibt davon unberührt — sie läuft nicht über baramundi.

**Zur dritten Gruppe, weil es hier früher falsch stand:** Diese drei Aktionen
sind `windows:`-Definitionen in `backend/actions.js` und laufen damit über den
eigenen Agenten, nicht über Graph. Der entscheidende Unterschied zur ersten
Gruppe ist aber, dass sie **nicht auf dem Gerät des Anwenders** laufen müssen:
`Get-ADUser` und `Unlock-ADAccount` brauchen irgendeinen Rechner in der Domäne
mit RSAT. Ein einziger Agent auf einem Verwaltungsserver genügt — kein
flächiges Ausrollen, keine Token auf hundert Arbeitsplätzen.

Damit ist Kontosperre und Passwortrücksetzung erreichbar, ohne dass baramundi
oder ein Agent im Feld existiert. Für ein Self-Service-Portal sind das die
beiden häufigsten Anliegen überhaupt.

**Offen dabei:** Der Agent läuft als `SYSTEM`, also unter dem Computerkonto.
Das darf im AD von Haus aus lesen, aber weder entsperren noch Passwörter
setzen. Dafür braucht es eine ausdrückliche Delegation auf die betreffende OU —
oder der Agent muss auf diesem einen Rechner unter einem eigenen Dienstkonto
laufen. `agent/install-windows.ps1` richtet ihn heute als `SYSTEM` ein.

Der Knackpunkt ist die erste Gruppe: **lesende Diagnose in Echtzeit.** Ein
Support-Gespräch fragt „wie voll ist die Platte jetzt". Über bConnect gäbe es
dafür zwei Wege, beide mit Haken:

1. **Inventardaten lesen.** baramundi kennt Platte, Speicher und installierte
   Software aus dem Inventarlauf. Der Treiber liest das bisher nicht; im
   Kopfkommentar steht `EndpointInvSoftware` als bekannter Controller. Der
   Haken: die Daten sind so alt wie der letzte Inventarlauf, nicht live.
2. **Für jede Frage einen Job auslösen.** Aktuell, aber langsam — Anlegen,
   Starten, Warten im Fünf-Sekunden-Takt. Für ein Gespräch zu träge.

Solange das nicht entschieden ist, ersetzt bConnect den Agenten **nicht
vollständig**.

## Was der Wechsel bringen würde

**Fällt weg:** ein selbst gebauter Dienst mit Systemrechten auf jedem
Arbeitsplatz, seine Verteilung, seine Token je Gerät und
`agent/install-windows.ps1` — also genau der Teil, der noch nie auf Windows
gelaufen ist und bei einer Prüfung die meisten Fragen aufwerfen würde.

**Bleibt:** Vier-Augen-Prinzip, verkettetes Audit-Log und die Freigabe im
Portal. Die sitzen vor dem Aufruf, unabhängig davon, wer ihn ausführt.

**Kommt dazu:** ein API-Benutzer auf dem bMS-Server — baramundi empfiehlt
selbst einen eigenen Benutzer mit möglichst wenigen Rechten — und eine neue
Betriebsabhängigkeit: steht der bMS-Server, kann das Portal nichts mehr am
Gerät.

## Der MCP-Server

baramundi bietet inzwischen einen MCP-Server an, also eine fertige Anbindung
für Sprachmodelle. Das ist **nicht angebunden** und sollte es vorerst auch
nicht werden. Die Regel aus `AGENTS.md` — Befehle entstehen im Backend, nie im
Modell — würde dadurch aufweichen: ein MCP-Server reicht dem Modell Werkzeuge
direkt, an unserer Freigabeliste und am Audit-Log vorbei. Wenn überhaupt, dann
so eingebunden, dass schreibende Aufrufe weiterhin durch `createJob()` und die
Freigabe laufen.

## Offene Fragen an die IT

1. ~~Ist **bConnect v2** in der laufenden bMS-Version enthalten?~~
   **Beantwortet:** ja, ab 2023 R1 und ohne eigene Konfiguration. Der Treiber
   steht auf `v2.0`.
2. ~~Welche **Anmeldeverfahren** nimmt die Instanz an?~~ **Beantwortet:**
   Windows, Basic und API Key. Der API-Schlüssel ist der Weg.
3. Liefert eine JobInstance **Rohausgabe** oder nur einen Status? Das
   entscheidet, ob Diagnose über Jobs überhaupt taugt. Steht im Schema.
4. Wie heißen die Endzustände einer JobInstance? `interpretState()` rät
   derzeit anhand von Teilstrings. Steht im Schema.
4. Wie oft läuft die **Inventarisierung**? Das entscheidet über Weg 1 oben.
5. Darf das Portal Jobs **auslösen** oder nur lesen?
6. Wer legt den API-Benutzer an, mit welchen Rechten?
7. Ist der bMS-Server aus dem Netz des Portals erreichbar?
8. Wird der **Kiosk** eingesetzt? Dann wäre er der natürliche Weg für
   Softwarewünsche.

## Empfehlung

Am eigenen Windows-Agenten **nicht weiterbauen**.

Der nächste Schritt ist jetzt billiger als gedacht: bConnect ist bereits aktiv,
es fehlen nur zwei Dateien von `/bconnect/docs` — `bConnect_Jobs.json` und
`bConnect_ActiveDirectory.json`. Die zweite entscheidet, ob Kontosperre und
Passwortrücksetzung ohne Agenten gehen. Damit sind Anmeldeverfahren, Zustandsnamen und die Frage nach
der Rohausgabe zu klären, **ohne** am produktiven System etwas auszulösen.
Danach einmal `listDevices` gegen den echten Server — rein lesend, beweist
Erreichbarkeit, Anmeldung und Zertifikat in einem Zug.

Erst danach lässt sich sagen, wie viel vom Agenten überhaupt übrig bleiben muss.
