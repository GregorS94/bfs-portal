// Auswertung der Diagnose-Ausgaben.
//
// Der Bot in Teams kann keine Konsolenausgabe anzeigen — er braucht Zahlen und
// einen Satz. Diese Datei übersetzt die Ausgabe der lesenden Aktionen in
// `{ used, status, label }`. Bewusst reine Funktionen ohne Seiteneffekte: so
// lässt sich jede Ausgabeform mit einem Textschnipsel prüfen, ohne Agent und
// ohne Gerät.
//
// Grundregel wie im übrigen Portal: was nicht gemessen wurde, wird nicht
// behauptet. Lässt sich eine Ausgabe nicht lesen, ist `used` null und der
// Status `unknown` — nicht 0 und nicht "ok".

const WARN_DISK_PERCENT = 90;
const WARN_MEMORY_PERCENT = 90;

/** Zahl aus "7,7Gi", "512M", "1.4G" — Einheit auf Byte normiert. */
function toBytes(text) {
  const match = String(text || '').trim().match(/^([\d.,]+)\s*([KMGTP]?)i?B?$/i);
  if (!match) return null;
  const value = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  const factor = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4, P: 1024 ** 5 };
  return value * factor[match[2].toUpperCase()];
}

function percent(used, total) {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
  return Math.round((used / total) * 100);
}

/**
 * Belegung des Systemlaufwerks aus der Ausgabe von `get_disk_space`.
 *
 * Linux: `df -h`, Zeile mit Einhängepunkt `/`. Windows: `Get-PSDrive`, Zeile
 * mit Wurzel `C:\`. Die Windows-Form ist nach der Dokumentation des Befehls
 * gebaut und nie auf echter Hardware gegengelesen — derselbe Vorbehalt wie bei
 * den Windows-Varianten in `actions.js`.
 */
function parseDisk(output) {
  const lines = String(output || '').split('\n').filter((l) => l.trim());
  const windows = lines.some((l) => /Used\s*\(GB\)/i.test(l));

  if (windows) {
    for (const line of lines) {
      // Name, Used (GB), Free (GB), Provider, Root — Root beginnt mit C:
      const cols = line.trim().split(/\s+/);
      if (!/^C:?\\?$/i.test(cols[cols.length - 1] || '')) continue;
      const used = Number(String(cols[1]).replace(',', '.'));
      const free = Number(String(cols[2]).replace(',', '.'));
      const pct = percent(used, used + free);
      if (pct !== null) return label('Systemlaufwerk', pct, WARN_DISK_PERCENT);
    }
    return unknown('Systemlaufwerk');
  }

  for (const line of lines) {
    const cols = line.trim().split(/\s+/);
    if (cols[cols.length - 1] !== '/') continue;
    // Dateisystem Größe Belegt Verfügbar Prozent Einhängepunkt
    const direct = Number(String(cols[4] || '').replace('%', ''));
    if (Number.isFinite(direct) && /%$/.test(cols[4] || '')) {
      return label('Systemlaufwerk', direct, WARN_DISK_PERCENT);
    }
    const pct = percent(toBytes(cols[2]), toBytes(cols[1]));
    if (pct !== null) return label('Systemlaufwerk', pct, WARN_DISK_PERCENT);
  }
  return unknown('Systemlaufwerk');
}

/** Belegung des Arbeitsspeichers aus der Ausgabe von `get_memory`. */
function parseMemory(output) {
  const text = String(output || '');

  const windows = text.match(/TotalVisibleMemorySize\s*:\s*(\d+)/i);
  if (windows) {
    const free = text.match(/FreePhysicalMemory\s*:\s*(\d+)/i);
    const total = Number(windows[1]);
    if (free) {
      const pct = percent(total - Number(free[1]), total);
      if (pct !== null) return label('Arbeitsspeicher', pct, WARN_MEMORY_PERCENT);
    }
    return unknown('Arbeitsspeicher');
  }

  for (const line of text.split('\n')) {
    // free -h:  Mem:  7,7Gi  5,9Gi  ...
    const cols = line.trim().split(/\s+/);
    if (!/^(Mem|Speicher):$/i.test(cols[0] || '')) continue;
    const pct = percent(toBytes(cols[2]), toBytes(cols[1]));
    if (pct !== null) return label('Arbeitsspeicher', pct, WARN_MEMORY_PERCENT);
  }
  return unknown('Arbeitsspeicher');
}

function label(name, used, warnAt) {
  const warn = used >= warnAt;
  return {
    used,
    status: warn ? 'warning' : 'ok',
    label: warn ? `${name} ${used}% belegt` : `${name} unauffällig (${used}%)`
  };
}

function unknown(name) {
  return { used: null, status: 'unknown', label: `${name}: Ausgabe nicht lesbar` };
}

/**
 * Ein Satz aus einer Befehlsausgabe — das, was der Bot im Chat vorliest.
 * Letzte nicht leere Zeile, gekürzt. Bei einem Fehler gewinnt die Fehlermeldung.
 */
function summarise(job) {
  if (!job) return null;
  if (job.error) return job.error;
  const lines = String(job.output || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return 'Ohne Ausgabe abgeschlossen.';
  return lines[lines.length - 1].slice(0, 300);
}

module.exports = {
  parseDisk, parseMemory, summarise, toBytes, percent,
  WARN_DISK_PERCENT, WARN_MEMORY_PERCENT
};
