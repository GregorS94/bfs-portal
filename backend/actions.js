// Freigegebene Aktionen — die KI wählt aus, welche und mit welchen Parametern.
// Der Befehlstext selbst steht hier fest und kommt nie aus dem Modell.
//
// Ausgeführt wird immer über execFile mit Argument-Array, niemals über eine Shell.
// Damit ist Kommando-Verkettung ("; rm -rf /") strukturell unmöglich, unabhängig
// davon, was ein Parameter enthält. Zusätzlich validiert jedes Feld gegen ein Muster.

const SERVICE_NAME = /^[A-Za-z0-9._@-]{1,64}$/;
const UNIT_PATH = /^[A-Za-z0-9._@/-]{1,128}$/;
// sAMAccountName oder UPN. Bewusst ohne Leerzeichen, Backslash und Klammern:
// damit kann kein DN und kein LDAP-Filter durchrutschen.
const AD_IDENTITY = /^[A-Za-z0-9._-]{1,64}(@[A-Za-z0-9.-]{1,192})?$/;

// `fourEyes: true` heisst: der Auftraggeber darf den eigenen Auftrag nicht
// freigeben. Fuer Aktionen, die fremde Konten betreffen, ist die Zustimmung
// des Anfragenden keine Kontrolle, sondern nur ein zweiter Klick.
const ACTIONS = {
  get_disk_space: {
    risk: 'read',
    description:
      'Zeigt die Festplattenbelegung des Geräts (Dateisysteme, Größe, belegt, frei, Prozent).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    linux: () => ({ file: 'df', args: ['-h', '-x', 'tmpfs', '-x', 'devtmpfs'] }),
    windows: () => ({
      file: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', 'Get-PSDrive -PSProvider FileSystem | Format-Table -AutoSize']
    })
  },

  get_memory: {
    risk: 'read',
    description: 'Zeigt Arbeitsspeicher- und Swap-Belegung des Geräts.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    linux: () => ({ file: 'free', args: ['-h'] }),
    windows: () => ({
      file: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory']
    })
  },

  get_uptime: {
    risk: 'read',
    description: 'Zeigt, wie lange das Gerät schon läuft, und die Systemlast.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    linux: () => ({ file: 'uptime', args: [] }),
    windows: () => ({
      file: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_OperatingSystem).LastBootUpTime']
    })
  },

  get_service_status: {
    risk: 'read',
    description:
      'Fragt den Status eines Dienstes ab (läuft er, seit wann, letzte Log-Zeilen). Parameter service: der Dienstname, z. B. "ssh" oder "docker".',
    input_schema: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Name des Dienstes, z. B. ssh, docker, cups' }
      },
      required: ['service'],
      additionalProperties: false
    },
    validate: (p) => (SERVICE_NAME.test(p.service || '') ? null : 'Ungültiger Dienstname.'),
    linux: (p) => ({ file: 'systemctl', args: ['status', p.service, '--no-pager', '--lines=15'] }),
    windows: (p) => ({
      file: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', 'Get-Service -Name $args[0] | Format-List', p.service]
    })
  },

  get_top_processes: {
    risk: 'read',
    description: 'Listet die Prozesse mit dem höchsten Speicherverbrauch.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    linux: () => ({ file: 'ps', args: ['-eo', 'pid,comm,%cpu,%mem', '--sort=-%mem'] }),
    windows: () => ({
      file: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', 'Get-Process | Sort-Object WS -Descending | Select-Object -First 10 Id,ProcessName,CPU,WS']
    })
  },

  get_failed_units: {
    risk: 'read',
    description: 'Listet alle Dienste, die aktuell im Fehlerzustand sind.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    linux: () => ({ file: 'systemctl', args: ['list-units', '--state=failed', '--no-pager'] }),
    windows: () => ({
      file: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', 'Get-Service | Where-Object {$_.Status -ne "Running" -and $_.StartType -eq "Automatic"}']
    })
  },

  restart_service: {
    risk: 'write',
    description:
      'Startet einen Dienst neu. Braucht Administratorrechte und die ausdrückliche Freigabe des Nutzers.',
    input_schema: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Name des Dienstes, der neu gestartet werden soll' }
      },
      required: ['service'],
      additionalProperties: false
    },
    validate: (p) => (SERVICE_NAME.test(p.service || '') ? null : 'Ungültiger Dienstname.'),
    linux: (p) => ({ file: 'systemctl', args: ['restart', p.service] }),
    windows: (p) => ({
      file: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', 'Restart-Service -Name $args[0] -Force', p.service]
    })
  },

  clear_journal_logs: {
    risk: 'write',
    description:
      'Räumt alte Systemprotokolle auf und gibt Plattenplatz frei. Braucht Administratorrechte und Freigabe.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    linux: () => ({ file: 'journalctl', args: ['--vacuum-time=7d'] }),
    windows: () => ({
      file: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', 'Clear-EventLog -LogName Application']
    })
  },

  // --- Konten im lokalen AD ------------------------------------------------
  // Hybrid: bei synchronisierten Konten ist das lokale AD die maßgebliche
  // Quelle. Hier gesetzt, wandert das Passwort per Hash-Sync nach Entra —
  // umgekehrt nur, wenn Password Writeback lizenziert und aktiv ist.
  // Es gibt bewusst keine Linux-Variante: ohne Domäne gibt es kein Konto.
  // Diese drei Aktionen sind nicht im Chat wählbar (`chat: false`) — sie
  // gehören in den IT-Bereich, und ihre Ausgabe darf nicht ins Modell zurück.

  get_ad_account_status: {
    risk: 'read',
    chat: false,
    description:
      'Zeigt den Zustand eines AD-Kontos: gesperrt, aktiv, Passwort abgelaufen, letzte Anmeldung.',
    input_schema: {
      type: 'object',
      properties: {
        identity: { type: 'string', description: 'Anmeldename oder UPN des Kontos' }
      },
      required: ['identity'],
      additionalProperties: false
    },
    validate: (p) => (AD_IDENTITY.test(p.identity || '') ? null : 'Ungültiger Kontoname.'),
    windows: (p) => ({
      file: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-ADUser -Identity $args[0] -Properties LockedOut,Enabled,PasswordExpired,' +
          'PasswordLastSet,LastLogonDate | Select-Object SamAccountName,Enabled,LockedOut,' +
          'PasswordExpired,PasswordLastSet,LastLogonDate | Format-List',
        p.identity
      ]
    })
  },

  unlock_ad_account: {
    risk: 'write',
    chat: false,
    fourEyes: true,
    description:
      'Hebt die Sperre eines AD-Kontos auf. Das Passwort bleibt unverändert.',
    input_schema: {
      type: 'object',
      properties: {
        identity: { type: 'string', description: 'Anmeldename oder UPN des Kontos' }
      },
      required: ['identity'],
      additionalProperties: false
    },
    validate: (p) => (AD_IDENTITY.test(p.identity || '') ? null : 'Ungültiger Kontoname.'),
    windows: (p) => ({
      file: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Unlock-ADAccount -Identity $args[0] -Confirm:$false; ' +
          '"Konto {0} entsperrt." -f $args[0]',
        p.identity
      ]
    })
  },

  reset_ad_password: {
    risk: 'write',
    chat: false,
    fourEyes: true,
    description:
      'Setzt ein neues Einmal-Passwort für ein AD-Konto und erzwingt die Änderung ' +
      'bei der nächsten Anmeldung.',
    input_schema: {
      type: 'object',
      properties: {
        identity: { type: 'string', description: 'Anmeldename oder UPN des Kontos' }
      },
      required: ['identity'],
      additionalProperties: false
    },
    validate: (p) => (AD_IDENTITY.test(p.identity || '') ? null : 'Ungültiger Kontoname.'),
    // Das Passwort entsteht auf dem Zielrechner und steht nur in der Ausgabe.
    // Es geht nie durch die Parameter — die landen im Audit-Log (jobs.js,
    // 'job.created'), die Ausgabe dagegen nur als Byte-Zahl.
    windows: (p) => ({
      file: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$b = [byte[]]::new(18); " +
          "[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); " +
          "$pw = 'Bfs!' + [Convert]::ToBase64String($b).TrimEnd('=').Replace('/','x').Replace('+','y'); " +
          'Set-ADAccountPassword -Identity $args[0] -Reset ' +
          '-NewPassword (ConvertTo-SecureString $pw -AsPlainText -Force) -Confirm:$false; ' +
          'Set-ADUser -Identity $args[0] -ChangePasswordAtLogon $true; ' +
          'Unlock-ADAccount -Identity $args[0] -Confirm:$false; ' +
          '"Einmal-Passwort fuer {0}: {1}" -f $args[0], $pw',
        p.identity
      ]
    })
  }
};

// Baut die Werkzeugliste für die Claude-API aus derselben Quelle.
// Aktionen mit `chat: false` bleiben draußen: Kontoaktionen gehören in den
// IT-Bereich, und ihre Ausgabe (Einmal-Passwort) darf nicht als tool_result
// zurück ins Modell und von dort in den Chatverlauf.
function toolDefinitions() {
  return Object.entries(ACTIONS)
    .filter(([, a]) => a.chat !== false)
    .map(([name, a]) => ({
      name,
      description:
        a.description +
        (a.risk === 'write'
          ? ' HINWEIS: Diese Aktion verändert das System und wird erst nach Freigabe durch den Nutzer ausgeführt.'
          : ''),
      input_schema: a.input_schema
    }));
}

// Übersetzt Aktion + Parameter in einen konkreten Befehl für die Plattform.
// Wirft, wenn die Aktion unbekannt ist oder ein Parameter das Muster verletzt.
function resolveCommand(actionName, params = {}, platform = 'linux') {
  const action = ACTIONS[actionName];
  if (!action) throw new Error(`Unbekannte Aktion: ${actionName}`);

  if (action.validate) {
    const problem = action.validate(params);
    if (problem) throw new Error(problem);
  }

  const builder = action[platform];
  if (!builder) throw new Error(`Aktion ${actionName} ist für ${platform} nicht definiert.`);

  return builder(params);
}

module.exports = { ACTIONS, toolDefinitions, resolveCommand, SERVICE_NAME, UNIT_PATH };
