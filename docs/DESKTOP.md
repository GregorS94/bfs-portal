# Desktop-Programm

Das Portal als Programm für Windows und macOS. Gebaut mit
[Tauri](https://tauri.app): dieselbe React-Oberfläche wie im Browser, in ein
Fenster gepackt, das das Betriebssystem des Rechners benutzt statt einen
zweiten Browser mitzubringen. Ein Paket liegt bei ungefähr zehn Megabyte;
Electron wäre bei hundertfünfzig.

**Stand: Gerüst.** Es baut, es öffnet ein Fenster, es zeigt das Portal. Was
noch fehlt, steht unten.

## Zwei Programme, nicht eins

Das ist die wichtigste Entscheidung an der ganzen Sache.

| | läuft als | darf |
|---|---|---|
| **BFS Support** (dieses Programm) | angemeldeter Mitarbeiter | fragen, anzeigen, freigeben |
| **bfs-agent** (Dienst) | SYSTEM | auf dem Gerät nachsehen und handeln |

Das Programm bekommt **keine** erhöhten Rechte. Im Chatfenster wird angezeigt,
was ein Sprachmodell erzeugt hat — das ist der letzte Ort, an dem man
Administratorrechte haben will. Und weil es im Kontext des angemeldeten
Mitarbeiters läuft, wäre jedes zusätzliche Recht ein Weg für jeden
Mitarbeiter, an genau dieses Recht zu kommen.

Was auf dem Gerät nachgesehen wird, macht deshalb weiterhin der Dienst — mit
eigener Freigabeliste, unabhängig vom Portal. Siehe
[SECURITY.md](SECURITY.md).

## Bauen

Lokal (braucht Rust und die Systemwerkzeuge von Tauri):

```bash
cd frontend && npm install && VITE_API_BASE=https://portal.bfs-abrechnung.de npm run build
cd ../desktop && npm install && npm run build
```

Die Oberfläche wird **zuerst und getrennt** gebaut. Tauri ruft sie nicht mehr
selbst auf: `beforeBuildCommand` läuft vom Ordner `desktop/` aus, `frontendDist`
gilt relativ zur Konfigurationsdatei in `src-tauri/` — zwei Bezugspunkte in
einer Datei, und genau daran ist der erste Lauf gescheitert. Ein Bezugspunkt
weniger ist die bessere Lösung.

`VITE_API_BASE` gehört an den **Bau der Oberfläche**, nicht an den von Tauri:
Vite backt den Wert dort ein.

Ergebnis unter `desktop/src-tauri/target/release/bundle/`.

**Für beide Betriebssysteme:** Ein Windows-Paket lässt sich nur unter Windows
bauen, ein Mac-Paket nur unter macOS. Dafür gibt es
`.github/workflows/desktop.yml` — Actions → Desktop → Run workflow, oder ein
Tag `v*` setzen. Die Pakete hängen danach als Artefakt am Lauf.

## `VITE_API_BASE`

Im Browser liefert derselbe nginx die Oberfläche und die API aus, `/api/...`
trifft also von selbst das Richtige. Im Programm ist der Ursprung
`tauri://localhost` — dort muss die Adresse des Portals beim Bauen mitgegeben
werden. Ohne die Variable bleibt alles relativ, der Browser-Betrieb ändert
sich nicht.

In GitHub hinterlegt unter Settings → Secrets and variables → Actions →
Variables als `PORTAL_URL`.

## Signieren

Ohne Signatur zeigt Windows „Unbekannter Herausgeber", und macOS startet das
Programm gar nicht erst.

**Windows:** Ein Zertifikat aus den eigenen AD-Zertifikatsdiensten reicht
vollständig, solange nur Firmengeräte das Programm bekommen — das
Wurzelzertifikat liegt per Gruppenrichtlinie ohnehin auf jedem Rechner. Ein
gekauftes Zertifikat braucht erst, wer ausserhalb des Hauses verteilt.

**macOS:** Apple akzeptiert keine firmeneigene Zertifizierungsstelle. Nötig
sind Apple Developer Program (99 USD im Jahr) und die Notarisierung, oder eine
Ausnahme über die MDM-Verwaltung der Macs.

Die Stellen im Workflow sind als Kommentar markiert.

## Verteilen

Über baramundi als Paket, wie jede andere Software. Das `.msi` installiert im
Systemkontext; die Aktualisierung läuft denselben Weg. Auf zweihundert
Rechnern klickt niemand von Hand.

## Was noch fehlt

- **Benachrichtigungen**, wenn die IT antwortet — das ist der eigentliche
  Grund für ein Programm statt eines Lesezeichens.
- **Symbol im Infobereich**, damit es im Hintergrund weiterlaufen kann.
- **Eigene Ansichten**: Der Entwurf in
  [`entwuerfe/desktop-app.html`](entwuerfe/desktop-app.html) zeigt „Meine
  Anfragen" und „Verlauf" als eigene Bereiche. Im Portal sind das heute Reiter.
- **Automatische Aktualisierung** — oder bewusst nicht, wenn baramundi das
  ohnehin übernimmt. Zwei Wege, die dasselbe tun, sind einer zu viel.
- **Auf echter Hardware geprüft.** Bisher ist nichts davon auf einem
  Windows-Rechner gelaufen.
