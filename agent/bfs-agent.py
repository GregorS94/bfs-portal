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

PORTAL_URL = os.environ.get("PORTAL_URL", "http://127.0.0.1:9001")
AGENT_TOKEN = os.environ.get("AGENT_TOKEN", "")
DEVICE_ID = os.environ.get("DEVICE_ID") or socket.gethostname()
POLL_TIMEOUT = 40  # muss über dem Long-Poll-Fenster des Servers liegen

# --- Freigabeliste des Agenten -------------------------------------------------
# Programm -> erlaubte erste Argumente (None = keine Einschränkung des Unterbefehls)
ALLOWED = {
    "df": None,
    "free": None,
    "uptime": None,
    "ps": None,
    "systemctl": {"status", "restart", "list-units"},
    "journalctl": {"--vacuum-time=7d"},
}

ARG_PATTERN = re.compile(r"^[A-Za-z0-9._@=:/,%-]{0,128}$")


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def request(method, path, payload=None, timeout=30):
    url = PORTAL_URL.rstrip("/") + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {AGENT_TOKEN}")
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

    allowed_subcommands = ALLOWED[file]
    if allowed_subcommands is not None:
        if not args or args[0] not in allowed_subcommands:
            return f"Unterbefehl '{args[0] if args else ''}' ist für {file} nicht freigegeben."

    for a in args:
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


def main():
    if not AGENT_TOKEN:
        log("FEHLER: AGENT_TOKEN ist nicht gesetzt.")
        sys.exit(1)

    info = {
        "deviceId": DEVICE_ID,
        "hostname": socket.gethostname(),
        "platform": "windows" if os.name == "nt" else "linux",
        "osVersion": platform.platform(),
    }

    # Vor jeder Runde neu registrieren. Das Portal hält die Geräteliste im
    # Speicher — startet es neu, waere der Agent sonst fuer immer unsichtbar.
    registered = False

    while True:
        if not registered:
            try:
                request("POST", "/api/agent/register", info, timeout=15)
                log(f"Registriert als {info['hostname']} ({info['platform']})")
                registered = True
            except Exception as e:
                log(f"Registrierung fehlgeschlagen ({e}) — neuer Versuch in 10 s")
                time.sleep(10)
                continue

        try:
            job = request("GET", f"/api/agent/jobs?deviceId={DEVICE_ID}", timeout=POLL_TIMEOUT)
        except urllib.error.HTTPError as e:
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
