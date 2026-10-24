# Gestaltung

Die Oberfläche hat **zwei Paletten** und eine einzige Struktur. Welche Palette
gilt, entscheidet eine Zeile in `frontend/index.html` — am Code darunter ändert
sich nichts.

## Warum zwei

Zwei Vorgaben standen gegeneinander:

- **BFS-Orange** ist die Hausfarbe von `bfs-abrechnung.de`, gemessen an den
  tatsächlich gerenderten Farben der Website (`#FF7700`, `#DB812D`, `#331D0B`).
  Das ist der Auftritt nach außen.
- **Petrol** kommt aus dem Gestaltungsleitfaden für dieses Werkzeug: ein
  internes Revisionswerkzeug eines beaufsichtigten Hauses, „nüchtern, präzise,
  revisionssicher". Petrol ist dort die einzige Aktionsfarbe, Marine trägt die
  Seitenspalte.

Entschieden ist zugunsten von **Petrol als Standard**, weil nur dieser Leitfaden
auch Layout, Typografie und Zustandsfarben festlegt und seine Wahl begründet:
Mitarbeitende sehen das Werkzeug gar nicht mehr — die arbeiten über den
Teams-Bot. Wer hier hineinschaut, ist IT.

Orange bleibt eingebaut, damit die Entscheidung umkehrbar ist, ohne noch einmal
jede Datei anzufassen.

## Umschalten

```
http://host:9000/?thema=orange     # einmal aufrufen, bleibt gespeichert
http://host:9000/?thema=petrol     # zurück
```

Die Wahl liegt in `localStorage` und gilt pro Browser. Es gibt bewusst **kein
Bedienelement** dafür: das ist eine Entscheidung des Hauses, keine Einstellung
für den einzelnen Benutzer.

## Farbrollen

Alle Farben sind CSS-Variablen in `frontend/index.html` und als Tailwind-Namen
verfügbar. Im Code steht nie ein Hexwert — wer einen schreibt, umgeht die
Palette und bricht die Umschaltbarkeit.

| Name                | Rolle                                           |
|---------------------|-------------------------------------------------|
| `akzent`            | die **einzige** Aktionsfarbe: Primärknöpfe, Freigeben, aktive Navigation |
| `schiene`           | Seitenspalte (Marine bzw. dunkles Braun)        |
| `tinte`             | Überschriften und Fließtext                     |
| `gedimmt`           | Metadaten, Beschriftungen                       |
| `leise`             | Hinweise, Platzhalter                           |
| `linie` / `flaeche` | Rahmen und Seitenhintergrund                    |
| `warnung`           | **nur** „wartet auf Freigabe"                   |
| `fehler`            | Eskalation, Ablehnung                           |
| `erfolg`            | abgeschlossen                                   |
| `lauf`              | in Bearbeitung                                  |
| `teams`             | **nur** für Microsoft Teams                     |

Jede Zustandsfarbe hat zusätzlich `-zart` (Fläche) und `-rand` (Rahmen).

## Regeln, die der Code einhält

- **Zustand nie allein über Farbe.** Die Komponente `Statuspille` zeigt immer
  Punkt *und* Wort. Wer Rot von Grün nicht unterscheidet, liest trotzdem alles.
- **Bernstein ist reserviert.** Er bedeutet „wartet auf Freigabe" und sonst
  nichts. Eine Rolle oder ein Gerätetyp bekommt nie Bernstein.
- **Eine Aktionsfarbe.** Alles, was der Benutzer auslösen kann, ist `akzent`.
  Zwei konkurrierende Aktionsfarben machen die Oberfläche unlesbar.
- **Kennungen und Zeitstempel** tragen die Klasse `zahlen`
  (`font-variant-numeric: tabular-nums`), damit Spalten beim Aktualisieren
  nicht springen.
- **Karten**: `rounded-xl border border-linie bg-white shadow-sm`.
  **Seitenspalte**: 220 px. **Tabellenzeilen**: 48 px.
- Schrift ist **Inter**, Kennungen und Befehle in JetBrains Mono.

## Was noch offen ist

- Schriften kommen per Google-Fonts-CDN, ebenso Tailwind. Für den Echtbetrieb
  gehören beide selbst gehostet — ein externes CDN ist in einem
  beaufsichtigten Haus ein Prüfungsthema (siehe `docs/PROZESSE.md`).
- Das echte BFS-Logo liegt nicht als Datei vor; `Wortmarke.jsx` ist ein
  Platzhalter in derselben Sprache, kein Nachbau.
