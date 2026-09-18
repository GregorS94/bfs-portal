import React, { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import Wortmarke from '../Wortmarke';

// Anmeldebildschirm. Zwei Wege, je nach Betriebsart des Backends:
//   entra  — Microsoft 365
//   simple — nur ein Name, ohne Prüfung (Prototyp)
export default function LoginScreen({ mode, ready, onSimpleSignIn, onEntraSignIn }) {
  const [identity, setIdentity] = useState('');
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

  const field = 'w-full px-4 py-2.5 bg-white border border-linie text-tinte rounded focus:outline-none focus:ring-2 focus:ring-akzent/50';

  return (
    <div className="flex items-center justify-center h-screen bg-flaeche px-4">
      <div className="w-full max-w-sm text-center">
        <Wortmarke className="mx-auto mb-6" />
        <h1 className="text-2xl font-semibold text-tinte mb-1">BFS IT-Support</h1>
        <p className="text-sm text-leise mb-8">Self-Service Portal</p>

        {!ready && <p className="text-sm text-leise">Einen Moment…</p>}

        {ready && mode === 'entra' && (
          <button onClick={onEntraSignIn}
            className="w-full px-6 py-2.5 bg-akzent hover:bg-akzent-hell text-white rounded font-medium text-sm transition-colors shadow-lg shadow-black/5">
            Mit Microsoft 365 anmelden
          </button>
        )}

        {ready && mode === 'simple' && (
          <div className="space-y-3 text-left">
            <div className="flex gap-2 items-start p-3 rounded bg-[#fdf3e2] border border-[#e9c98f] text-[#8a5200] text-xs">
              <ShieldAlert size={16} className="shrink-0 mt-0.5" />
              <span>Testbetrieb: Der Name wird <strong>nicht geprüft</strong>. Das ist keine Anmeldung im Sinne einer Authentifizierung.</span>
            </div>
            <label className="block text-sm text-gedimmt">Anmeldename</label>
            <input value={identity} autoFocus
              onChange={(e) => setIdentity(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && identity.trim() && submitSimple()}
              placeholder="a.muster@bfs.de" className={field} />
            <button onClick={submitSimple} disabled={busy || !identity.trim()}
              className="w-full px-6 py-2.5 bg-akzent hover:bg-akzent-hell disabled:bg-[#ddd8d1] disabled:text-leise text-white rounded font-medium text-sm transition-colors">
              {busy ? 'Anmelden…' : 'Weiter'}
            </button>
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 rounded bg-[#fbeaea] border border-[#e8bcbc] text-rose-200 text-sm text-left">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
