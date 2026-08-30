# Entra-ID-Anmeldung einschalten

Der Code ist fertig. Es fehlen nur zwei IDs aus deinem Mandanten.
Solange `ENTRA_ENABLED` nicht auf `true` steht, läuft das Portal wie bisher mit
dem Entwicklungs-Benutzer weiter.

## 1. Kostenlosen Testmandanten anlegen (zuhause)
portal.azure.com → *Microsoft Entra ID* → *Mandanten verwalten* → **Erstellen**.
Entra ID Free kostet nichts. Danach zwei, drei Testbenutzer anlegen.

## 2. App-Registrierung
*Microsoft Entra ID → App-Registrierungen → Neue Registrierung*

- **Name:** BFS Self-Service Portal
- **Kontotypen:** nur Konten in diesem Organisationsverzeichnis
- **Umleitungs-URI:** Plattform **Single-Page-Anwendung (SPA)**,
  URI `http://192.168.178.62:9000`
  (später zusätzlich die Produktiv-URL eintragen — mehrere sind erlaubt)

Aus der Übersicht notieren:
- **Anwendungs-ID (Client)** → `ENTRA_CLIENT_ID`
- **Verzeichnis-ID (Mandant)** → `ENTRA_TENANT_ID`

## 3. API verfügbar machen
*App-Registrierung → Eine API verfügbar machen*
- **Anwendungs-ID-URI festlegen** → übernimmt `api://<client-id>`
- **Bereich hinzufügen**: Name `access_as_user`, Zustimmung durch Administratoren
  und Benutzer, Anzeigenamen ausfüllen.
- Vollständiger Bereichswert (das ist `ENTRA_API_SCOPE`):
  `api://<client-id>/access_as_user`

## 4. Eintragen und neu starten
In `~/bfs-portal/.env` auf dem Pi:

```
ENTRA_ENABLED=true
ENTRA_TENANT_ID=<Verzeichnis-ID>
ENTRA_CLIENT_ID=<Anwendungs-ID>
ENTRA_API_SCOPE=api://<Anwendungs-ID>/access_as_user
```

```bash
cd ~/bfs-portal && docker compose up -d backend
```

Kein Neubau nötig — das Frontend holt die Werte zur Laufzeit von `/api/config`.

## 5. Prüfen
- Portal aufrufen → Schaltfläche „Mit Microsoft 365 anmelden"
- Nach der Anmeldung steht oben links der echte Name aus Entra
- Tab **Status** → Zeile „Entra-Anmeldung" muss GRÜN sein
- Im Audit-Log steht ab jetzt die echte Benutzerkennung als Freigeber, nicht mehr
  der Entwicklungs-Benutzer

## Was beim Umzug in die Firma zu tun ist
`ENTRA_TENANT_ID` und `ENTRA_CLIENT_ID` gegen die Firmenwerte tauschen und im
Firmen-Mandanten dieselbe App-Registrierung anlegen. Der Code bleibt gleich.

## Bewusste Entscheidung
Ist `ENTRA_ENABLED=true`, aber die Konfiguration unvollständig, antwortet das
Backend mit **500 und blockiert alles** — statt stillschweigend auf den
Entwicklungs-Benutzer zurückzufallen. Ein halb aktiver Anmeldeschutz ist
gefährlicher als gar keiner.

---

# Rollen

Drei Stufen, aufsteigend: **user → it → admin**.

| Rolle | Sieht | Darf |
|---|---|---|
| `user` (Mitarbeiter) | Chat, Passwort, Software | chatten, Diagnosen auslösen, **eigene** Aktionen freigeben |
| `it` (IT-Support) | + Geräte, Audit-Log | fremde Aufträge einsehen und freigeben |
| `admin` | + Status | alles |

**Durchgesetzt wird das im Backend**, nicht durch versteckte Reiter. Ein `user`,
der `/api/audit` direkt aufruft, bekommt 403 — auch mit gültigem Token.

## Ohne Entra (heute)
`DEV_ROLE=user|it|admin` in `~/bfs-portal/.env`, dann `docker compose up -d backend`.
Standard ist `admin`. So lassen sich alle drei Sichten ohne Mandanten durchspielen.

## Mit Entra: App-Rollen anlegen
*App-Registrierung → App-Rollen → App-Rolle erstellen*

| Anzeigename | Wert | Zulässige Mitgliedertypen |
|---|---|---|
| IT-Support | `portal.it` | Benutzer/Gruppen |
| Administrator | `portal.admin` | Benutzer/Gruppen |

Danach unter *Unternehmensanwendungen → deine App → Benutzer und Gruppen* die
Personen zuweisen. Wer keine Rolle zugewiesen bekommt, ist automatisch `user` —
die kleinste Rolle ist der Standard, mehr Rechte müssen ausdrücklich vergeben werden.

**Notnagel für Testmandanten ohne App-Rollen:** `ENTRA_ADMIN_USERS` und
`ENTRA_IT_USERS` in der `.env`, kommagetrennte Anmeldenamen.
