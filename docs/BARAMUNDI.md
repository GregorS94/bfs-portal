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

## Die Lücke zum eigenen Agenten

Die Aktionen in `backend/actions.js` zerfallen in drei Gruppen:

| Gruppe | Beispiele | Läuft heute über |
|---|---|---|
| Diagnose am Gerät | `get_disk_space`, `get_memory`, `get_service_status`, `get_top_processes`, `get_failed_units` | eigener Agent |
| Eingriff am Gerät | `restart_service`, `clear_journal_logs` | eigener Agent |
| Verzeichnisdienst | `get_ad_account_status`, `unlock_ad_account`, `reset_ad_password` | AD/Entra, **nicht** der Agent |

bConnect deckt heute nur die zweite Gruppe ab, und zwar als Job. Die dritte
Gruppe bleibt unberührt — sie läuft nicht über baramundi.

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

1. Welche bMS-Version läuft — und ist **bConnect v2** darin enthalten? Davon
   hängt ab, ob der Treiber auf `v2.0` und den API-Schlüssel umgestellt werden
   kann (er steht heute auf `v1.0` mit Basic-Auth).
2. Liefert eine JobInstance **Rohausgabe** oder nur einen Status? Das
   entscheidet, ob Diagnose über Jobs überhaupt taugt.
3. Wie heißen die Endzustände einer JobInstance? `interpretState()` rät
   derzeit anhand von Teilstrings.
4. Wie oft läuft die **Inventarisierung**? Das entscheidet über Weg 1 oben.
5. Darf das Portal Jobs **auslösen** oder nur lesen?
6. Wer legt den API-Benutzer an, mit welchen Rechten?
7. Ist der bMS-Server aus dem Netz des Portals erreichbar?
8. Wird der **Kiosk** eingesetzt? Dann wäre er der natürliche Weg für
   Softwarewünsche.

## Empfehlung

Am eigenen Windows-Agenten **nicht weiterbauen**. Stattdessen zuerst Frage 1
bis 3 klären und den Treiber einmal gegen den echten Server laufen lassen —
danach lässt sich sagen, wie viel vom Agenten überhaupt übrig bleiben muss.
