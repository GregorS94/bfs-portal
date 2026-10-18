// Bremse gegen Durchprobieren von Passwoertern.
//
// Ein lokales Konto mit vier Zeichen ist in Sekunden durchprobiert, wenn nichts
// bremst. Gezaehlt wird je Kennung UND je Absenderadresse: sonst sperrt ein
// Angreifer durch absichtliche Fehlversuche fremde Konten aus
// (Denial of Service ueber die eigene Schutzfunktion).
//
// Reine Rechnung mit einstellbarer Uhr, damit die Fristen pruefbar sind, ohne
// im Test zu warten. Der Zustand liegt im RAM — nach einem Neustart ist er weg,
// und das ist fuer einen Prototyp vertretbar.

const MAX_FEHLER = 5;
const FENSTER_MS = 15 * 60 * 1000;
const SPERRE_MS = 5 * 60 * 1000;

function createLockout({ maxFehler = MAX_FEHLER, fensterMs = FENSTER_MS, sperreMs = SPERRE_MS } = {}) {
  const zaehler = new Map();

  const eintrag = (key, now) => {
    const vorhanden = zaehler.get(key);
    // Ausserhalb des Fensters faengt die Zaehlung neu an.
    if (!vorhanden || now - vorhanden.erster > fensterMs) {
      const neu = { erster: now, fehler: 0, bis: 0 };
      zaehler.set(key, neu);
      return neu;
    }
    return vorhanden;
  };

  return {
    /** Gesperrt? Gibt die Restzeit in Sekunden zurueck, sonst 0. */
    blocked(key, now = Date.now()) {
      const e = zaehler.get(key);
      if (!e || !e.bis || e.bis <= now) return 0;
      return Math.ceil((e.bis - now) / 1000);
    },
    /** Fehlversuch zaehlen. Gibt true zurueck, wenn damit gesperrt wurde. */
    fail(key, now = Date.now()) {
      const e = eintrag(key, now);
      e.fehler += 1;
      if (e.fehler >= maxFehler) {
        e.bis = now + sperreMs;
        return true;
      }
      return false;
    },
    /** Erfolgreiche Anmeldung loescht die Zaehlung. */
    reset(key) {
      zaehler.delete(key);
    },
    /** Nur fuer Pruefungen. */
    size() {
      return zaehler.size;
    }
  };
}

module.exports = { createLockout, MAX_FEHLER, FENSTER_MS, SPERRE_MS };
