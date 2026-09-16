# Installation auf einem frischen Ubuntu Server

Schrittfolge von der leeren VM bis zum laufenden Portal. Die Reihenfolge ist
nicht beliebig: die Docker-Adressbereiche müssen stehen, **bevor** der Stack
zum ersten Mal erzeugt wird, sonst hilft nur noch Abreissen und Neubauen.

Getestet gegen Ubuntu Server 24.04 LTS. Ältere LTS-Stände funktionieren
genauso, die Befehle lesen den Codenamen selbst aus.

Alles mit `<spitzen Klammern>` ist zu ersetzen.

---

## 1. Grundsystem

```bash
sudo apt update && sudo apt upgrade -y
sudo hostnamectl set-hostname srv-ssp01
sudo timedatectl set-timezone Europe/Berlin
timedatectl                       # NTP aktiv? Das Audit-Log braucht richtige Zeit.
```

Abmelden und neu anmelden, damit die Eingabeaufforderung den neuen Namen zeigt.

## 2. Feste IP-Adresse

Erst nachsehen, wie die Schnittstelle heisst und was gerade gilt:

```bash
ip -br a
ip route | grep default
resolvectl status | grep -A2 'DNS Servers'
```

Ubuntu Server richtet sein Netz über cloud-init ein. Das muss abgeschaltet
werden, sonst wird die eigene Konfiguration beim nächsten Neustart überschrieben:

```bash
echo 'network: {config: disabled}' \
  | sudo tee /etc/cloud/cloud.cfg.d/99-disable-network-config.cfg
```

Dann die eigene Datei (die hohe Nummer sorgt dafür, dass sie zuletzt gilt):

```bash
sudo tee /etc/netplan/99-static.yaml >/dev/null <<'YAML'
network:
  version: 2
  ethernets:
    <ens18>:
      dhcp4: false
      addresses: [<172.18.38.50>/23]
      routes:
        - to: default
          via: <172.18.38.1>
      nameservers:
        addresses: [<10.11.1.10>, <10.11.1.11>]
        search: [<bfs.intern>]
YAML
sudo chmod 600 /etc/netplan/99-static.yaml
```

Netzmaske als Präfix: `/23` entspricht `255.255.254.0`, `/24` entspricht
`255.255.255.0`. Bei falscher Angabe ist der Server aus Teilen des Netzes
unerreichbar.

**Steht der Server in einem anderen Netz als die Clients** — im aktuellen
Aufbau `192.168.2.104` — dann mit dessen Werten und `/24`:

```yaml
network:
  version: 2
  ethernets:
    ens18:
      dhcp4: false
      addresses: [192.168.2.104/24]
      routes:
        - to: default
          via: 192.168.2.1
      nameservers:
        addresses: [192.168.2.1, 1.1.1.1]
```

Das ist unproblematisch, solange zwischen beiden Netzen geroutet wird — siehe
Schritt 11. Die Adresse gehört zusätzlich im Router reserviert oder aus dem
DHCP-Bereich genommen, sonst bekommt sie irgendwann ein zweites Gerät.

Wer sich das Aussperr-Risiko ganz sparen will, macht statt netplan nur eine
DHCP-Reservierung auf die MAC-Adresse. Für einen Server ist die feste
Konfiguration sauberer, für einen Testaufbau reicht die Reservierung.

**Zum Übernehmen `netplan try`, nicht `netplan apply`.** `try` macht die
Änderung nach 120 Sekunden ohne Bestätigung von selbst rückgängig — wer sich
per SSH aussperrt, kommt so wieder rein:

```bash
sudo netplan try
```

Bleibt die Verbindung stehen, mit Enter bestätigen. Danach prüfen:

```bash
ip -br a
ping -c2 <172.18.38.1>
ping -c2 1.1.1.1
getent hosts github.com
```

Die IP gehört zusätzlich im DNS eingetragen und im DHCP reserviert oder
ausgeschlossen, sonst vergibt der Server sie irgendwann ein zweites Mal.

## 3. Docker installieren

Nicht `apt install docker.io` — das Paket aus den Ubuntu-Quellen ist älter und
bringt das Compose-Plugin nicht mit. Aus der offiziellen Quelle:

```bash
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
```

Prüfen:

```bash
docker --version
docker compose version        # ohne Bindestrich
```

## 4. Adressbereiche setzen — vor dem ersten Start

Docker vergibt seinen Containern ab Werk Adressen aus `172.17.0.0/12`. Das
BFS-Clientnetz `172.18.38.0/23` steckt vollständig in dem Bereich. Passiert
das, hält jeder Container `172.18.38.x` für seinen eigenen Nachbarn und legt
die Pakete auf die Bridge, statt sie zum Router zu geben: **kein Fehler, keine
Meldung, nur Zeitüberschreitungen an unerwarteter Stelle.**

```bash
sudo tee /etc/docker/daemon.json >/dev/null <<'JSON'
{
  "default-address-pools": [
    { "base": "10.180.0.0/16", "size": 24 }
  ],
  "bip": "10.181.0.1/24",
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON

sudo systemctl restart docker
docker network inspect bridge --format '{{(index .IPAM.Config 0).Subnet}}'
```

Erwartete Ausgabe: `10.181.0.0/24`. Steht dort etwas mit `172.` — Datei prüfen,
`journalctl -u docker -n 50` lesen, nicht weitermachen.

Die beiden `log-opts` sind kein Kosmetik-Eintrag: ohne sie wachsen
Container-Logs unbegrenzt, bis die Platte voll ist.

Die Zahlen sind gegen die bekannten BFS-Bereiche geprüft (Clients
`172.18.38.0/23`, Standorte `10.11.x` und `10.21.x`, Azure-VNet `10.0.0.0/16`,
AKS `10.244.0.0/16`, Kubernetes `10.42`, `10.43`, `10.96`) — vom Netzwerkteam
trotzdem gegenzeichnen lassen.

## 5. Benutzer in die Docker-Gruppe

```bash
sudo usermod -aG docker $USER
```

**Danach einmal komplett abmelden und neu anmelden.** `newgrp` reicht nur für
die laufende Sitzung. Prüfen mit `docker ps` — ohne `sudo`, ohne Fehler.

Wer den Stack einmal mit `sudo` baut, hinterlässt root-eigene Dateien im
Checkout; der nächste `git pull` ohne `sudo` scheitert dann.

## 6. Verzeichnis anlegen

```bash
sudo mkdir -p /opt/bfs-portal
sudo chown $USER:docker /opt/bfs-portal
sudo chmod 750 /opt/bfs-portal
```

`/opt` ist der Platz für selbst installierte Software und hängt an keinem
Benutzerkonto. In `/home/<name>/` wäre der Dienst faktisch Privatbesitz und
verschwände mit dem Konto.

## 7. Repository holen

Das Repo ist privat, also braucht der Server einen eigenen Lese-Schlüssel:

```bash
ssh-keygen -t ed25519 -C "srv-ssp01 deploy" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Den ausgegebenen Schlüssel in GitHub eintragen: Repository → Settings → Deploy
keys → Add deploy key. **Kein Schreibrecht vergeben** — der Server soll nur
lesen. Dann:

```bash
ssh -T git@github.com          # "successfully authenticated" erwartet
git clone git@github.com:GregorS94/bfs-portal.git /opt/bfs-portal
cd /opt/bfs-portal
```

Meldet `git clone`, das Verzeichnis sei nicht leer, dann liegt schon etwas
darin — nachsehen statt löschen.

## 8. Konfiguration

```bash
cp .env.example .env
chmod 600 .env
openssl rand -hex 32           # Ausgabe als AGENT_TOKEN eintragen
nano .env
```

Pflicht für den ersten Start:

```bash
ANTHROPIC_API_KEY=sk-ant-...
AGENT_TOKEN=<die eben erzeugte Zeichenkette>
AUDIT_RETENTION_DAYS=<Zahl>    # vor Produktivbetrieb Pflicht, siehe PROZESSE.md
```

Atlassian, Entra und bConnect bleiben zunächst leer — die sind über die
Administrationsseite bequemer zu setzen, samt Probelauf-Knopf gegen das echte
System. Ohne Entra-Konfiguration meldet das Portal einen Entwicklungs-Benutzer
mit der Rolle aus `DEV_ROLE` an.

Eine Falle: `ENTRA_ENABLED=true` mit unvollständigen IDs lässt **alle**
Portal-Routen mit 500 antworten. Das ist Absicht, kein Fehler.

## 9. Starten

```bash
cd /opt/bfs-portal
docker compose up -d --build
```

Der erste Bau dauert ein paar Minuten. Danach:

```bash
docker compose ps                        # drei Dienste, alle healthy
curl -s localhost:9001/health
curl -sI localhost:9000 | head -1        # HTTP/1.1 200 OK
docker network inspect bfs-portal_default \
  --format '{{(index .IPAM.Config 0).Subnet}}'   # 10.180.x.x erwartet
```

| Dienst | Adresse |
|--------|---------|
| Frontend | http://srv-ssp01:9000 |
| Backend | http://srv-ssp01:9001 |
| Attrappen-API | http://srv-ssp01:9002 |

## 10. Firewall auf dem Server (ufw)

```bash
# SSH zuerst — und zwar aus JEDEM Netz, aus dem verwaltet wird
sudo ufw allow from <192.168.2.0/24> to any port 22 proto tcp
sudo ufw allow from <172.18.38.0/23> to any port 22 proto tcp

sudo ufw allow from <172.18.38.0/23> to any port 9000 proto tcp
sudo ufw allow from <172.18.38.0/23> to any port 9001 proto tcp

sudo ufw enable
sudo ufw status verbose
```

**SSH zuerst freigeben, sonst sperrt `ufw enable` die laufende Sitzung aus.**
Und zwar für das Netz, aus dem du gerade verbunden bist — steht der Server in
`192.168.2.x` und gibst du nur das Clientnetz frei, fliegst du im selben Moment
raus, in dem die Regel greift. Vor `ufw enable` also einmal prüfen:

```bash
who        # aus welcher Adresse kommt die eigene Sitzung?
```

Bleibt eine zweite Sitzung offen, während die erste die Regel setzt, ist der
Weg zurück immer frei.

Port 9002 bleibt zu — die Attrappen-API ist Testwerkzeug und hat im Clientnetz
nichts verloren. Wer sie nicht braucht: `docker compose stop mock-api`.

**ufw und Docker vertragen sich nur halb.** Veröffentlichte Ports hängt Docker
direkt in die `DOCKER-USER`-Kette und umgeht ufw dabei. Solange 9000/9001
ohnehin offen sein sollen, spielt das keine Rolle; soll ein Port wirklich dicht
sein, gehört die Regel nach `DOCKER-USER` oder die Veröffentlichung wird auf
`127.0.0.1:9000:80` eingeschränkt.

## 11. Firewall dazwischen (Sophos)

Stehen Server und Clients in verschiedenen Netzen, hängt eine Firewall
dazwischen. Drei Punkte entscheiden darüber, ob das Portal sich richtig
verhält oder nur fast.

**Es wird nur eine Richtung gebraucht.** Der Geräte-Agent baut die Verbindung
immer von sich aus zum Portal auf und hält sie per Long-Poll offen
(`POLL_TIMEOUT = 40` in `agent/bfs-agent.py`, Serverfenster 25 s in
`backend/jobs.js`). Das Portal verbindet sich nie von sich aus zu einem Client.

```
<Clientnetz>  ->  <Portal-IP>  :9001/tcp    Agent und API
<Clientnetz>  ->  <Portal-IP>  :9000/tcp    Browser
```

Keine Regel in die Gegenrichtung. 9002 bleibt zu.

**Kein Web-Proxy, keine TLS-Inspection auf diesen Regeln.** Das ist der Punkt,
der sonst einen Tag Fehlersuche kostet. Die Chat-Antwort wird gestreamt —
deshalb steht `proxy_buffering off` in der nginx-Konfiguration. Eine Firewall,
die die Antwort erst vollständig einsammelt, bevor sie sie weiterreicht, macht
daraus zehn Sekunden Stille und dann eine Wand aus Text. Das sieht nach einem
Fehler im Portal aus und ist keiner. Dasselbe gilt für den Long-Poll: eine
Verbindung, die 25 Sekunden offen steht, ohne ein einziges Byte zu senden,
wirkt auf manche Scanner wie eine hängende Sitzung.

Also als reine Layer-3/4-Regel anlegen.

**TCP-Idle-Timeout über 40 Sekunden.** Die Vorgabe liegt deutlich darüber, aber
ein angepasstes Regelwerk kann den Wert gesenkt haben. Liegt er unter 40, bricht
jeder Long-Poll ab: der Agent meldet sich ständig neu, Aufträge kommen verzögert
statt sofort an. Das Symptom ist Trägheit, nicht Ausfall — entsprechend leicht
wird es der Anwendung angelastet.

Ausgehend braucht der Server nur HTTPS zu `api.anthropic.com`, später Atlassian
und Microsoft Graph. Auch die Anthropic-Antwort streamt; dieselbe Vorsicht mit
der Inspection.

## 12. Neustart überstehen

Die Container tragen `restart: unless-stopped`, kommen also von allein wieder.
Einmal beweisen:

```bash
sudo reboot
# nach dem Hochfahren:
docker compose -f /opt/bfs-portal/docker-compose.yml ps
```

## 13. Danach

- **TLS davor.** 9000 spricht nur HTTP. Produktiv gehört ein Reverse Proxy mit
  Zertifikat davor; `proxy_buffering off` ist dabei Pflicht, sonst kommt die
  Chat-Antwort erst am Stück statt im Fluss.
- **Geräte-Agent ausrollen** — gehört nach `/opt/bfs-agent/`, getrennt vom
  Portal, und wird von `scripts/deploy.sh` absichtlich nicht mitaktualisiert.
  Siehe [`SETUP.md`](SETUP.md).
- **`AGENT_TOKEN` rotieren**, sobald die Agenten angemeldet sind. Es wird nur
  zum Anmelden gebraucht, bleibt danach aber gültig.
- **Sicherung.** Die Daten liegen nicht im Checkout, sondern im benannten
  Volume unter `/var/lib/docker/volumes/`. Zu sichern sind das Volume **und**
  die `.env`:

  ```bash
  docker run --rm -v bfs-portal_audit_data:/data -v /var/backups:/out \
    alpine tar czf /out/audit-$(date +%F).tgz -C /data .
  sudo cp /opt/bfs-portal/.env /var/backups/env-$(date +%F).bak
  ```

- **Aktualisieren** später über `scripts/deploy.sh` — das prüft, ob auf dem
  Host etwas vom letzten Ausrollen abweicht, bevor es etwas überschreibt.

---

## Wenn es klemmt

| Symptom | Ursache |
|---------|---------|
| Container erreicht keine Clients, nur Zeitüberschreitungen | Adressbereich aus Schritt 4 nicht gesetzt oder Stack davor erzeugt. `docker compose down`, prüfen, `up` — `restart` genügt nicht. |
| `permission denied` am Docker-Socket | Nach `usermod` nicht neu angemeldet. |
| Alle Portal-Routen antworten mit 500 | `ENTRA_ENABLED=true` bei unvollständigen IDs. Absicht. |
| Chat scheitert, Portal läuft | `ANTHROPIC_API_KEY` fehlt oder der Server kommt nicht an `api.anthropic.com`. |
| Nach Neustart ist die IP wieder per DHCP | cloud-init aus Schritt 2 nicht abgeschaltet. |
| `git pull` scheitert mit Rechtefehler | Stack einmal mit `sudo` gebaut. `sudo chown -R $USER:docker /opt/bfs-portal`. |
| Chat antwortet erst nach langer Stille, dann alles auf einmal | TLS-Inspection oder Web-Proxy auf der Firewall puffert den Strom. Schritt 11. |
| Agent meldet sich ständig neu an, Aufträge kommen verzögert | TCP-Idle-Timeout der Firewall unter 40 Sekunden. Schritt 11. |
