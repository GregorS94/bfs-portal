<#
.SYNOPSIS
  Richtet den BFS Support Agent auf einem Windows-Gerät ein.

.DESCRIPTION
  Das Gegenstück zu bfs-agent.service. Der Agent läuft als geplante Aufgabe
  unter dem Konto SYSTEM — das ist unter Windows dasselbe wie `User=root`
  unter Linux.

  Warum eine geplante Aufgabe und kein Dienst: Ein Windows-Dienst muss dem
  Dienststeuerungs-Manager antworten. Ein gewöhnliches Python-Skript tut das
  nicht und würde nach dreissig Sekunden als "reagiert nicht" beendet. Der
  übliche Ausweg wären Fremdprogramme wie NSSM oder WinSW — eine geplante
  Aufgabe mit Start beim Hochfahren und Neustart bei Fehlern leistet dasselbe,
  ohne dass eine fremde Binärdatei auf jedes Firmengerät muss.

  Auszuführen als Administrator, oder über baramundi im Systemkontext.

.PARAMETER PortalUrl
  Adresse des Portals, z. B. https://portal.bfs-abrechnung.de

.PARAMETER AgentToken
  Das gemeinsame Geheimnis für die Erstanmeldung. Danach holt sich das Gerät
  ein eigenes Token; dieses hier wird nur einmal gebraucht.

.PARAMETER PythonPath
  Pfad zu python.exe. Ohne Angabe wird gesucht.

.EXAMPLE
  .\install-windows.ps1 -PortalUrl https://portal.bfs-abrechnung.de -AgentToken 'xxx'

.NOTES
  Auf einem echten Windows-Gerät noch nicht gelaufen — geschrieben, aber
  ungetestet. Siehe docs/SECURITY.md.
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PortalUrl,
  [Parameter(Mandatory = $true)][string]$AgentToken,
  [string]$PythonPath,
  [string]$InstallDir = "$env:ProgramFiles\BFS Support Agent",
  [string]$DataDir = "$env:ProgramData\BFS"
)

$ErrorActionPreference = 'Stop'

# --- Voraussetzungen ---------------------------------------------------------

$istAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $istAdmin) {
  throw 'Bitte als Administrator ausführen — der Agent läuft als SYSTEM.'
}

if (-not $PythonPath) {
  $gefunden = Get-Command python.exe -ErrorAction SilentlyContinue
  if (-not $gefunden) { $gefunden = Get-Command py.exe -ErrorAction SilentlyContinue }
  if (-not $gefunden) {
    throw 'Kein Python gefunden. Mit -PythonPath angeben oder vorher ausrollen.'
  }
  $PythonPath = $gefunden.Source
}

Write-Host "Python: $PythonPath"

# --- Dateien ablegen ---------------------------------------------------------

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Path (Join-Path $PSScriptRoot 'bfs-agent.py') -Destination $InstallDir -Force
Write-Host "Agent liegt in $InstallDir"

# --- Konfiguration -----------------------------------------------------------
# Der Token steht in einer Datei, nicht in einer systemweiten
# Umgebungsvariablen: die könnte jeder angemeldete Benutzer auslesen.

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$envDatei = Join-Path $DataDir 'bfs-agent.env'

@(
  "# Vom Installationsskript geschrieben — enthält ein Geheimnis.",
  "PORTAL_URL=$PortalUrl",
  "AGENT_TOKEN=$AgentToken"
) | Set-Content -Path $envDatei -Encoding UTF8

# Vererbung abschalten und nur SYSTEM und Administratoren zulassen. Ohne das
# erbt der Ordner die Rechte von ProgramData, wo jeder Benutzer lesen darf —
# und der Anmeldetoken wäre für jeden lesbar.
$acl = Get-Acl $DataDir
$acl.SetAccessRuleProtection($true, $false)
$acl.Access | ForEach-Object { [void]$acl.RemoveAccessRule($_) }
foreach ($konto in @('NT AUTHORITY\SYSTEM', 'BUILTIN\Administrators')) {
  $regel = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $konto, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  $acl.AddAccessRule($regel)
}
Set-Acl -Path $DataDir -AclObject $acl
Write-Host "Konfiguration in $envDatei (nur SYSTEM und Administratoren)"

# --- Geplante Aufgabe --------------------------------------------------------

$aufgabe = 'BFS Support Agent'
Unregister-ScheduledTask -TaskName $aufgabe -Confirm:$false -ErrorAction SilentlyContinue

$aktion = New-ScheduledTaskAction `
  -Execute $PythonPath `
  -Argument "`"$InstallDir\bfs-agent.py`""

$ausloeser = New-ScheduledTaskTrigger -AtStartup

$konto = New-ScheduledTaskPrincipal `
  -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest

# Kein Zeitlimit: der Agent läuft dauerhaft und hält die Verbindung offen.
# RestartCount/RestartInterval entsprechen Restart=always in systemd.
$einstellungen = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $aufgabe -Action $aktion -Trigger $ausloeser `
  -Principal $konto -Settings $einstellungen `
  -Description 'Nimmt Aufträge des BFS Self-Service Portals entgegen und führt nur freigegebene Befehle aus.' | Out-Null

Start-ScheduledTask -TaskName $aufgabe
Write-Host "Aufgabe '$aufgabe' eingerichtet und gestartet."
Write-Host ''
Write-Host 'Prüfen mit:'
Write-Host "  Get-ScheduledTask -TaskName '$aufgabe' | Get-ScheduledTaskInfo"
Write-Host '  Get-Process python -ErrorAction SilentlyContinue'
Write-Host ''
Write-Host 'Entfernen mit:'
Write-Host "  Unregister-ScheduledTask -TaskName '$aufgabe' -Confirm:`$false"
Write-Host "  Remove-Item -Recurse '$InstallDir', '$DataDir'"
