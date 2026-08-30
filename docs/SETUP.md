# Installation

## Voraussetzungen

- Docker mit Compose-Plugin
- Ein Anthropic-API-Schlüssel
- Für den Geräte-Agenten: Python 3 auf dem Zielrechner (nur Standardbibliothek,
  keine Pakete)

Entwickelt und betrieben auf einem Raspberry Pi 5 (8 GB). Die Images bauen
unter arm64 und amd64 gleichermaßen.

## Portal starten

```bash
git clone <repo> bfs-portal && cd bfs-portal
cp .env.example .env
```

In der `.env` sind zwei Werte Pflicht:

```bash
ANTHROPIC_API_KEY=sk-ant-...
AGENT_TOKEN=$(openssl rand -hex 32)
```

Alles Weitere — Atlassian, Graph, bConnect — lässt sich später bequemer über
die Administrationsseite eintragen.

```bash
docker compose up -d --build
docker compose ps          # drei Dienste, alle healthy
curl -s localhost:9001/health
```

| Dienst | Adresse |
|--------|---------|
| Frontend | http://localhost:9000 |
| Backend | http://localhost:9001 |
| Attrappen-API | http://localhost:9002 |

Ohne Entra-Konfiguration meldet das Portal einen Entwicklungs-Benutzer an,
dessen Rolle aus `DEV_ROLE` kommt (Vorgabe `admin`, damit alle Bereiche
sichtbar sind).

## Entwicklungsbetrieb mit Hot-Reload

```bash
docker compose -f docker-compose.dev.yml up
```

Bindet die Quellen ein, statt sie ins Image zu kopieren.

## Geräte-Agent

Auf dem Rechner, der diagnostiziert werden soll:

```bash
sudo mkdir -p /opt/bfs-agent
sudo cp agent/bfs-agent.py /opt/bfs-agent/

sudo tee /etc/bfs-agent.env >/dev/null <<'ENV'
PORTAL_URL=http://<portal-host>:9001
AGENT_TOKEN=<derselbe Wert wie in der .env des Portals>
DEVICE_ID=buero-pc-01
ENV
sudo chmod 600 /etc/bfs-agent.env

sudo cp agent/bfs-agent.service /etc/systemd/system/
sudo systemctl enable --now bfs-agent
journalctl -u bfs-agent -f
```

`DEVICE_ID` ist optional; ohne Angabe nimmt der Agent den Hostnamen.

Beim ersten Start meldet er sich mit `AGENT_TOKEN` an und bekommt ein eigenes
Geräte-Token, das er unter `/etc/bfs-agent.token` (0600) ablegt. Danach
arbeitet er nur noch damit; `AGENT_TOKEN` wird erst wieder gebraucht, wenn das
Gerät neu angemeldet werden soll.

Anschließend sendet er alle 40 Sekunden ein Lebenszeichen — nach einem
Backend-Neustart taucht er von selbst wieder auf.

**Token rotieren:** `/etc/bfs-agent.token` löschen und den Dienst neu starten.
Das alte Token verfällt dabei.

**Gerät sperren:** als `admin` über `POST /api/admin/agents/<deviceId>/revoke`.
Wirkt sofort; das Gerät kann sich auch nicht neu anmelden.

Der Agent läuft als root. Das ist beabsichtigt und der Grund, warum die
Absicherung in der Freigabeliste liegt: siehe [`SECURITY.md`](SECURITY.md).

## Anmeldung über Entra ID

Siehe [`ENTRA_SETUP.md`](ENTRA_SETUP.md). Kurzfassung: App registrieren,
`ENTRA_ENABLED=true` sowie Tenant-ID, Client-ID und API-Scope setzen.

Das Frontend holt diese Werte zur Laufzeit über `/api/config` — nach einer
Änderung genügt ein Neustart des Backends, das Frontend muss **nicht** neu
gebaut werden.

Achtung: `ENTRA_ENABLED=true` mit unvollständigen IDs lässt alle Portal-Routen
mit 500 antworten. Das ist Absicht, kein Fehler.

## Fremdsysteme anbinden

Als `admin` unter `/admin` → Einstellungen. Pro Gruppe gibt es einen
Probelauf-Knopf, der die Zugangsdaten sofort gegen das echte System prüft.
Gespeicherte Werte haben Vorrang vor der `.env`; Treiber lesen sie bei jedem
Zugriff frisch, ein Neustart ist nicht nötig.

Für bConnect ist `BCONNECT_ALLOWED_JOBS` Pflicht — ohne diese Liste ist kein
einziger Job ausführbar.

## Vor dem Produktivbetrieb

`AUDIT_RETENTION_DAYS` setzen — ohne Frist wächst das Audit-Log unbegrenzt und
enthält dabei Personenbezug. Welche Frist angemessen ist, gehört mit
Datenschutz und Betriebsrat geklärt; siehe [`PROZESSE.md`](PROZESSE.md).

Ausserdem: `AGENT_TOKEN` nach dem Ausrollen der Agenten rotieren. Es wird nur
zum Anmelden gebraucht, ist danach aber weiterhin gültig.
