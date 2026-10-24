import React, { useState } from 'react';
import { ShieldAlert, KeyRound } from 'lucide-react';
import Wortmarke from '../Wortmarke';

// Anmeldebildschirm. Drei Wege, je nach Betriebsart des Backends:
//   entra  — Microsoft 365
//   local  — Konto und Passwort aus der Datenbank des Portals
//   simple — nur ein Name, ohne Prüfung (Prototyp)
export default function LoginScreen({ mode, ready, onSimpleSignIn, onLocalSignIn, onEntraSignIn }) {
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submitSimple = async () => {
    setError('');
    setBusy(true);
    try {
      await onSimpleSignIn(identity.trim());
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  const submitLocal = async () => {
    setError('');
    setBusy(true);
    try {
      await onLocalSignIn(identity.trim(), password);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  const localReady = identity.trim() && password;

  const field = 'w-full px-4 py-2.5 bg-white border border-linie text-tinte rounded focus:outline-none focus:ring-2 focus:ring-akzent/50';

  return (
    <div className="flex items-center justify-center h-screen bg-flaeche px-4">
      <div className="w-full max-w-sm text-center">
        {/* Die Wortmarke trägt den Namen schon — eine zweite Überschrift
            darunter wiederholte ihn nur. */}
        <Wortmarke mittig className="mb-2" />
        <p className="text-sm text-gedimmt mb-8">Anmeldung</p>

        {!ready && <p className="text-sm text-leise">Einen Moment…</p>}

        {ready && mode === 'entra' && (
          <button onClick={onEntraSignIn}
            className="w-full px-6 py-2.5 bg-akzent hover:bg-akzent-hell text-white rounded font-medium text-sm transition-colors shadow-lg shadow-black/5">
            Mit Microsoft 365 anmelden
          </button>
        )}

        {ready && mode === 'local' && (
          <div className="space-y-3 text-left">
            <label className="block text-sm text-gedimmt">Anmeldename</label>
            <input value={identity} autoFocus autoComplete="username"
              onChange={(e) => setIdentity(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && localReady && submitLocal()}
              placeholder="admin" className={field} />
            <label className="block text-sm text-gedimmt">Passwort</label>
            <input value={password} type="password" autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && localReady && submitLocal()}
              placeholder="••••" className={field} />
            <button onClick={submitLocal} disabled={busy || !localReady}
              className="w-full px-6 py-2.5 bg-akzent hover:bg-akzent-hell disabled:bg-linie disabled:text-leise text-white rounded font-medium text-sm transition-colors flex items-center justify-center gap-2">
              <KeyRound size={15} /> {busy ? 'Anmelden…' : 'Anmelden'}
            </button>
            {/* Muss hier stehen und nicht nur in der Dokumentation: solange die
                ausgelieferten Passwoerter gelten, ist das Portal fuer jeden
                offen, der diesen Satz kennt. */}
            <div className="flex gap-2 items-start p-3 rounded bg-warnung-zart border border-warnung-rand text-warnung text-xs">
              <ShieldAlert size={16} className="shrink-0 mt-0.5" />
              <span>
                Prototyp: Geprüft wird gegen die Konten des Portals, nicht gegen das
                Unternehmensverzeichnis. Die Startkonten <strong>admin/admin</strong> und{' '}
                <strong>user/1234</strong> sind öffentlich bekannt und gehören im Administrationsbereich geändert.
              </span>
            </div>
          </div>
        )}

        {ready && mode === 'simple' && (
          <div className="space-y-3 text-left">
            <div className="flex gap-2 items-start p-3 rounded bg-warnung-zart border border-warnung-rand text-warnung text-xs">
              <ShieldAlert size={16} className="shrink-0 mt-0.5" />
              <span>Testbetrieb: Der Name wird <strong>nicht geprüft</strong>. Das ist keine Anmeldung im Sinne einer Authentifizierung.</span>
            </div>
            <label className="block text-sm text-gedimmt">Anmeldename</label>
            <input value={identity} autoFocus
              onChange={(e) => setIdentity(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && identity.trim() && submitSimple()}
              placeholder="a.muster@bfs.de" className={field} />
            <button onClick={submitSimple} disabled={busy || !identity.trim()}
              className="w-full px-6 py-2.5 bg-akzent hover:bg-akzent-hell disabled:bg-linie disabled:text-leise text-white rounded font-medium text-sm transition-colors">
              {busy ? 'Anmelden…' : 'Weiter'}
            </button>
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 rounded bg-fehler-zart border border-fehler-rand text-fehler text-sm text-left">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
