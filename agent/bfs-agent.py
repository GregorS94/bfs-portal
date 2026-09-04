#!/usr/bin/env python3
"""BFS Support Agent — läuft als Dienst auf dem Client (Linux: root, Windows später: LocalSystem).

Der Agent baut die Verbindung selbst auf und hält sie per Long-Polling offen.
Damit ist keine eingehende Verbindung und keine Firewall-Öffnung nötig.

Sicherheit: der Agent führt NICHT aus, was das Portal ihm schickt, sondern prüft
jeden Befehl gegen eine eigene Freigabeliste. Wäre das Portal übernommen, könnte
ein Angreifer damit trotzdem nur diese Programme mit diesen Unterbefehlen starten.
Zweite Verteidigungslinie, unabhängig vom Backend.
"""

import json
import os
import platform
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

def _konfigdatei():
    """Die Datei mit PORTAL_URL und AGENT_TOKEN.

    Unter Linux liest systemd sie als EnvironmentFile ein, bevor der Agent
    startet. Unter Windows gibt es dafür kein Gegenstück: Ein Dienst erbt keine
    Umgebung, und der Token in eine systemweite Umgebungsvariable zu schreiben
    hiesse, ihn jedem angemeldeten Benutzer zu zeigen. Also liest der Agent die
    Datei dort selbst.
    """
    if platform.system() == "Windows":
        basis = os.environ.get("ProgramData", r"C:\ProgramData")
        return os.path.join(basis, "BFS", "bfs-agent.env")
    return "/etc/bfs-agent.env"


def lade_konfigdatei(pfad=None):
    """Setzt KEY=VALUE-Zeilen als Umgebungsvariablen — aber überschreibt nichts.

    Was schon in der Umgebung steht, gewinnt. Sonst könnte eine vergessene
    Datei auf der Platte eine bewusst gesetzte Variable aushebeln.
    """
    pfad = pfad or os.environ.get("AGENT_ENV_FILE") or _konfigdatei()
    try:
        with open(pfad, "r", encoding="utf-8") as fh:
            zeilen = fh.readlines()
    except OSError:
        return {}

    gesetzt = {}
    for zeile in zeilen:
        zeile = zeile.strip()
        if not zeile or zeile.startswith("#") or "=" not in zeile:
            continue
        schluessel, _, wert = zeile.partition("=")
        schluessel = schluessel.strip()
        wert = wert.strip().strip('"').strip("'")
        if schluessel and schluessel not in os.environ:
            os.environ[schluessel] = wert
            gesetzt[schluessel] = wert
    return gesetzt


lade_konfigdatei()

PORTAL_URL = os.environ.get("PORTAL_URL", "http://127.0.0.1:9001")
DEVICE_ID = os.environ.get("DEVICE_ID") or socket.gethostname()
POLL_TIMEOUT = 40  # muss über dem Long-Poll-Fenster des Servers liegen

# Das gemeinsame Geheimnis aus /etc/bfs-agent.env dient nur noch dem Anmelden.
# Danach hat dieses Gerät ein eigenes Token, das nur für es selbst gilt und im
# Portal einzeln gesperrt werden kann.
ENROLL_TOKEN = os.environ.get("AGENT_TOKEN", "")


def _standard_tokenpfad():
    """Wo das Geräte-Token liegt.

    Unter Linux /etc, unter Windows ProgramData — dort darf LocalSystem
    schreiben, und ein angemeldeter Benutzer kommt ohne Adminrechte nicht
    heran. Ein Token unter C:\\Users wäre für den Benutzer lesbar und damit
    kein Geräte-Token mehr.
    """
    if platform.system() == "Windows":
        basis = os.environ.get("ProgramData", r"C:\ProgramData")
        return os.path.join(basis, "BFS", "bfs-agent.token")
    return "/etc/bfs-agent.token"


TOKEN_FILE = os.environ.get("AGENT_TOKEN_FILE") or _standard_tokenpfad()

# Wird beim Anmelden gesetzt und für alle weiteren Aufrufe verwendet.
device_token = ""

# --- Freigabeliste des Agenten -------------------------------------------------
# Programm -> erlaubte erste Argumente (None = keine Einschränkung des Unterbefehls)
ALLOWED_LINUX = {
    "df": None,
    "free": None,
    "uptime": None,
    "ps": None,
    "systemctl": {"status", "restart", "list-units"},
    "journalctl": {"--vacuum-time=7d"},
}

# Unter Windows gibt es keinen dieser Befehle; dort laeuft alles ueber
# PowerShell. Genau das ist die Gefahr: `powershell.exe` einfach freizugeben
# hiesse, beliebigen Code zuzulassen, und die Freigabeliste waere wertlos.
#
# Deshalb wird hier nicht das Programm freigegeben, sondern der Skripttext:
# er muss Zeichen fuer Zeichen einem der unten stehenden entsprechen. Parameter
# stehen nie im Text, sondern als eigene Argumente dahinter ($args[0]) und
# werden wie unter Linux gegen ARG_PATTERN geprueft.
#
# Die Liste ist eine bewusste Verdopplung von backend/actions.js. Der Agent
# soll gerade nicht darauf vertrauen, was das Portal ihm schickt — waere das
# Portal uebernommen, ist diese Datei die zweite Verteidigungslinie. Gegen
# stilles Auseinanderlaufen prueft tools/agent-allowlist-test.js beide Listen
# gegeneinander.
PS_PRAEFIX = ["-NoProfile", "-NonInteractive", "-Command"]

ALLOWED_POWERSHELL = {
    # get_disk_space
    'Get-PSDrive -PSProvider FileSystem | Format-Table -AutoSize',
    # get_memory
    'Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory',
    # get_uptime
    '(Get-CimInstance Win32_OperatingSystem).LastBootUpTime',
    # get_service_status
    'Get-Service -Name $args[0] | Format-List',
    # get_top_processes
    'Get-Process | Sort-Object WS -Descending | Select-Object -First 10 Id,ProcessName,CPU,WS',
    # get_failed_units
    'Get-Service | Where-Object {$_.Status -ne "Running" -and $_.StartType -eq "Automatic"}',
    # restart_service
    'Restart-Service -Name $args[0] -Force',
    # clear_journal_logs
    'Clear-EventLog -LogName Application',
    # get_ad_account_status
    'Get-ADUser -Identity $args[0] -Properties LockedOut,Enabled,PasswordExpired,PasswordLastSet,LastLogonDate | Select-Object SamAccountName,Enabled,LockedOut,PasswordExpired,PasswordLastSet,LastLogonDate | Format-List',
    # unlock_ad_account
    'Unlock-ADAccount -Identity $args[0] -Confirm:$false; "Konto {0} entsperrt." -f $args[0]',
    # reset_ad_password
    '$b = [byte[]]::new(18); [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); $pw = \'Bfs!\' + [Convert]::ToBase64String($b).TrimEnd(\'=\').Replace(\'/\',\'x\').Replace(\'+\',\'y\'); Set-ADAccountPassword -Identity $args[0] -Reset -NewPassword (ConvertTo-SecureString $pw -AsPlainText -Force) -Confirm:$false; Set-ADUser -Identity $args[0] -ChangePasswordAtLogon $true; Unlock-ADAccount -Identity $args[0] -Confirm:$false; "Einmal-Passwort fuer {0}: {1}" -f $args[0], $pw',
}

ALLOWED_WINDOWS = {"powershell.exe": None}

IST_WINDOWS = platform.system() == "Windows"
ALLOWED = ALLOWED_WINDOWS if IST_WINDOWS else ALLOWED_LINUX

ARG_PATTERN = re.compile(r"^[A-Za-z0-9._@=:/,%-]{0,128}$")


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def request(method, path, payload=None, timeout=30, token=None):
    url = PORTAL_URL.rstrip("/") + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token if token is not None else device_token}")
    # Das Portal prüft das Token gegen genau diese Gerätekennung.
    req.add_header("X-Device-Id", DEVICE_ID)
    if data:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        if resp.status == 204:
            return None
        body = resp.read().decode()
        return json.loads(body) if body else None


def check_allowed(command):
    """Gibt None zurück, wenn der Befehl erlaubt ist, sonst den Ablehnungsgrund."""
    file = command.get("file")
    args = command.get("args") or []

    if file not in ALLOWED:
        return f"Programm '{file}' steht nicht auf der Freigabeliste des Agenten."

    if file == "powershell.exe":
        if args[:3] != PS_PRAEFIX:
            return "PowerShell darf nur mit -NoProfile -NonInteractive -Command aufgerufen werden."
        if len(args) < 4 or args[3] not in ALLOWED_POWERSHELL:
            return "Dieser PowerShell-Befehl steht nicht auf der Freigabeliste des Agenten."
        # Der Skripttext ist durch den Vergleich oben abgedeckt; geprueft werden
        # muessen die Parameter dahinter.
        zu_pruefen = args[4:]
    else:
        allowed_subcommands = ALLOWED[file]
        if allowed_subcommands is not None:
            if not args or args[0] not in allowed_subcommands:
                return f"Unterbefehl '{args[0] if args else ''}' ist für {file} nicht freigegeben."
        zu_pruefen = args

    for a in zu_pruefen:
        if not isinstance(a, str) or not ARG_PATTERN.match(a):
            return f"Argument enthält unerlaubte Zeichen: {a!r}"

    return None


def run(command):
    file = command["file"]
    args = command.get("args") or []
    # Kein shell=True: die Argumentliste geht direkt an execve, es gibt keine
    # Shell, die Metazeichen interpretieren könnte.
    proc = subprocess.run(
        [file] + args,
        capture_output=True,
        text=True,
        timeout=120,
    )
    output = proc.stdout
    if proc.stderr:
        output += ("\n--- stderr ---\n" + proc.stderr)
    return output.strip(), proc.returncode


def load_token():
    """Liest das gerätespezifische Token, falls schon eins vergeben wurde."""
    try:
        with open(TOKEN_FILE, "r", encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return ""


def store_token(token):
    """Legt das Token mit 0600 ab — es ist der Schlüssel dieses Geräts."""
    ordner = os.path.dirname(TOKEN_FILE)
    if ordner:
        os.makedirs(ordner, exist_ok=True)
    # 0o600 wirkt nur unter Linux. Unter Windows schützt der Ort: ProgramData\BFS
    # erbt die Rechte von ProgramData, Schreiben darf dort nur ein Administrator
    # oder LocalSystem. Das Installationsskript engt den Ordner zusätzlich ein.
    fd = os.open(TOKEN_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(token)


def enroll(info):
    """Meldet das Gerät mit dem gemeinsamen Geheimnis an und holt ein eigenes Token."""
    global device_token
    if not ENROLL_TOKEN:
        log("FEHLER: AGENT_TOKEN ist nicht gesetzt — ohne ihn ist keine Anmeldung möglich.")
        sys.exit(1)

    result = request("POST", "/api/agent/register", info, timeout=15, token=ENROLL_TOKEN)
    token = (result or {}).get("agentToken")
    if not token:
        raise RuntimeError("Portal hat kein Geräte-Token geliefert.")

    device_token = token
    try:
        store_token(token)
    except OSError as exc:
        # Nicht tödlich: der Agent läuft weiter, muss sich nach einem Neustart
        # aber erneut anmelden. Das gehört gesagt, nicht verschwiegen.
        log(f"WARNUNG: Token konnte nicht in {TOKEN_FILE} gespeichert werden ({exc}).")
    log("Angemeldet, eigenes Geräte-Token erhalten.")


def main():
    global device_token
    device_token = load_token()

    info = {
        "deviceId": DEVICE_ID,
        "hostname": socket.gethostname(),
        "platform": "windows" if os.name == "nt" else "linux",
        "osVersion": platform.platform(),
    }

    # Vor jeder Runde neu registrieren. Das Portal hält die Geräteliste im
    # Speicher — startet es neu, waere der Agent sonst fuer immer unsichtbar.
    # Eine erneute Anmeldung vergibt dabei ein frisches Token; das alte verfällt.
    registered = bool(device_token)

    while True:
        if not registered:
            try:
                # Mit gueltigem Token genuegt ein Lebenszeichen. Sich jedes Mal
                # neu anzumelden wuerde im 40-Sekunden-Takt ein neues Token
                # vergeben und das Audit-Log mit Anmeldungen fluten.
                if device_token:
                    request("POST", "/api/agent/heartbeat", info, timeout=15)
                else:
                    enroll(info)
                    log(f"Registriert als {info['hostname']} ({info['platform']})")
                registered = True
            except urllib.error.HTTPError as e:
                if e.code == 403:
                    log("Dieses Gerät ist im Portal gesperrt. Warte auf Freigabe.")
                    time.sleep(60)
                elif e.code == 401 and device_token:
                    # Token gesperrt oder unbekannt: beim naechsten Durchlauf
                    # ohne Token, also ueber die richtige Anmeldung.
                    log("Geräte-Token abgelehnt — melde neu an")
                    device_token = ""
                else:
                    log(f"Anmeldung fehlgeschlagen (HTTP {e.code}) — neuer Versuch in 10 s")
                    time.sleep(10)
                continue
            except Exception as e:
                log(f"Anmeldung fehlgeschlagen ({e}) — neuer Versuch in 10 s")
                time.sleep(10)
                continue

        try:
            job = request("GET", f"/api/agent/jobs?deviceId={DEVICE_ID}", timeout=POLL_TIMEOUT)
        except urllib.error.HTTPError as e:
            if e.code == 401:
                # Token gesperrt oder das Portal kennt es nicht mehr.
                log("Geräte-Token abgelehnt — melde neu an")
                device_token = ""
            else:
                log(f"HTTP {e.code} beim Abholen — registriere neu")
            registered = False
            time.sleep(5)
            continue
        except Exception as e:
            log(f"Verbindung verloren ({e}) — registriere neu")
            registered = False
            time.sleep(5)
            continue

        if not job:
            # Zeitfenster abgelaufen, keine Arbeit. Registrierung auffrischen,
            # damit "zuletzt gesehen" im Portal aktuell bleibt.
            registered = False
            continue

        job_id = job["jobId"]
        command = job["command"]
        reason = check_allowed(command)

        if reason:
            log(f"ABGELEHNT {job['action']}: {reason}")
            try:
                request("POST", f"/api/agent/jobs/{job_id}/result", {"error": reason})
            except Exception as e:
                log(f"Ergebnis konnte nicht gemeldet werden: {e}")
            continue

        log(f"Führe aus: {job['action']} -> {command['file']} {' '.join(command.get('args') or [])}")
        try:
            output, code = run(command)
            request("POST", f"/api/agent/jobs/{job_id}/result", {"output": output, "exitCode": code})
            log(f"Fertig: {job['action']} (Exit {code})")
        except subprocess.TimeoutExpired:
            request("POST", f"/api/agent/jobs/{job_id}/result", {"error": "Zeitüberschreitung nach 120 s"})
        except Exception as e:
            try:
                request("POST", f"/api/agent/jobs/{job_id}/result", {"error": str(e)})
            except Exception:
                log(f"Ergebnis konnte nicht gemeldet werden: {e}")


if __name__ == "__main__":
    main()
