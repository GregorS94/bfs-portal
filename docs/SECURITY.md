# Sicherheitsmodell

Die Leitfrage des Projekts: Ein Sprachmodell darf auf einem fremden Rechner
Befehle auslösen. Was hindert es daran, etwas anderes zu tun als das, was
gemeint war?

## Zwei unabhängige Kontrollen

**1. Das Backend baut den Befehl, nicht das Modell.**
Jede Aktion hat in `actions.js` eine feste Vorlage, die `file` und `args`
zurückgibt. Das Modell liefert nur Parameter, die gegen ein JSON-Schema
geprüft werden. Es gibt keinen Pfad, auf dem ein vom Modell erzeugter String
zu einem Befehlstext wird.

**2. Der Agent prüft noch einmal selbst.**
`bfs-agent.py` führt nur aus, was in seiner eigenen Freigabeliste steht. Ein
kompromittiertes Backend kann dem Agenten nichts Beliebiges unterschieben.

Dazu: kein `shell=True`, argv geht direkt an `execve`. Es gibt keine Shell,
die Metazeichen interpretieren könnte.

Im Test abgewiesen: `bash -c`, `curl`, `systemctl mask`, ein Argument mit `;`.

## Eingabevalidierung an den Rändern

| Stelle | Risiko | Abwehr |
|--------|--------|--------|
| AD-Kontoname | LDAP-Filter, DN-Injektion | `AD_IDENTITY`-Regex: kein Leerzeichen, kein Backslash, keine Klammer. Eigenes argv-Element, nie im Befehlstext |
| UPN → Graph | OData-`$filter` aufbrechen und alle Benutzer erhalten | enge Regex, im Treiber *und* im Endpunkt |
| Suchtext → Confluence | ein `"` bricht die CQL-Abfrage auf | `cqlQuote()` maskiert |
| Text → Jira | fremde ADF-Knoten einschleusen | `toAdf()` baut die Absätze selbst, kein Durchreichen |
| Jira-Projekt | Tickets in fremden Projekten | Projekt und Vorgangstyp kommen aus der Konfiguration, nie aus dem Aufruf |
| bMS-Jobs | Rollouts und Compliance-Läufe auslösen | `BCONNECT_ALLOWED_JOBS`; ohne diese Liste ist nichts ausführbar |

## Geheimnisse

- **Das Einmal-Passwort ist kein Parameter.** Es entsteht auf dem Zielrechner
  über `RandomNumberGenerator`. Parameter landen vollständig im Audit-Log,
  Ausgaben nur als `outputBytes`.
- **Geheimnisse gehen nie an den Browser zurück.** Die Einstellungs-API
  liefert pro Feld nur `set: true/false`. Ein leeres Geheimnisfeld heißt
  „nicht anfassen" — sonst löschte jedes Speichern das Token, weil das
  Formular es nie im Klartext kennt. Zum Entfernen dient `null`.
- `settings.updated` im Audit-Log protokolliert **nur die Feldnamen**.
- `redact()` läuft vor jedem Jira-Ticket: Ein Ticket ist für viele lesbar und
  steht jahrelang; was nach Passwort, Token oder Schlüssel aussieht, wird zu
  `[entfernt]`.

## Anmeldung

JWT-Prüfung über `jose` gegen die Entra-JWKS. Bewusste Entscheidung:
**eine unvollständige Konfiguration blockiert, statt auf den
Entwicklungs-Benutzer zurückzufallen.** `ENTRA_ENABLED=true` ohne Tenant- und
Client-ID liefert 500 auf allen Portal-Routen. Ein stiller Rückfall auf einen
ungeprüften Benutzer wäre die gefährlichere Variante.

Die Agent-API hängt an einem eigenen Token, nicht an Entra — ein Dienst hat
keine interaktive Anmeldung.

## Bewusste Grenzen

- **SSPR hat keine API.** Microsoft stellt keinen Endpunkt bereit, um den
  Rücksetz-Dialog auszulösen. `authenticationMethod: resetPassword` ist nur
  *delegiert* nutzbar, verlangt *Authentication Administrator* und erreicht in
  Hybrid-Mandanten das lokale AD nur mit Password Writeback. Ein Dienst-Token
  kann das nicht — deshalb nicht implementiert. Was geht, ist die Triage:
  `isSsprEnabled`, `isSsprRegistered`, `isSsprCapable`.
- **`GET /api/health/services` ist ungeschützt.** Absicht: ein externer
  Wächter soll ohne Anmeldung Schlüsselwörter prüfen können. Die Antwort
  verrät die Anzahl bekannter Geräte und welche Fremdsysteme konfiguriert
  sind. Im abgeschlossenen Netz vertretbar; für einen Produktivbetrieb
  gehörte ein eigenes Monitoring-Token davor.
- **Aufträge und Geräte liegen im RAM.** Nach einem Backend-Neustart sind sie
  weg. Das Audit-Log überlebt, weil es auf Platte geschrieben wird.
- **Ein Ticket pro Gespräch** wird im RAM verfolgt. Nach einem Neustart kann
  dasselbe Gespräch ein zweites Ticket erzeugen.
- **Der Agent läuft als root** (Äquivalent zu LocalSystem). Das ist der Sinn
  der Übung — Diagnose und Reparatur brauchen Rechte. Die Absicherung liegt
  deshalb vollständig in der Freigabeliste, nicht in den Rechten des Prozesses.

## Was nicht geprüft ist

- Freigabe eines **fremden** Auftrags als Rolle `user` — dafür braucht es zwei
  echte Identitäten, also einen Mandanten.
- Der Hybrid-Fall am echten Entra-Mandanten.
- Der bConnect-Treiber gegen einen echten baramundi-Server; verifiziert ist er
  nur gegen `tools/bconnect-mock.js`.
