// Ergaenzt die Express-Anfrage um das Feld, das `auth.js` dort ablegt.
//
// Ohne diese Datei meldet die Typpruefung an rund zwanzig Stellen
// "Property 'user' does not exist on type 'Request'" — Express kennt das
// Feld nicht, weil es unsere eigene Zwischenschicht hineinschreibt.
// Am Laufzeitverhalten aendert die Datei nichts; sie wird nie ausgeliefert.

import 'express';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        name?: string;
        role?: string;
        [weiteres: string]: unknown;
      };
      /** Setzt `requireAgent`, nachdem es das Geraetetoken geprueft hat. */
      deviceId?: string;
    }
  }
}
