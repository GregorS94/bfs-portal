import React, { useState } from 'react';
import { KeyRound, ShieldAlert } from 'lucide-react';
import Wortmarke from '../Wortmarke';

// Anmeldebildschirm. Drei Wege, je nach Betriebsart des Backends:
//   entra  — Microsoft 365
//   simple — nur ein Name, ohne Prüfung (Prototyp)
// Dazu, in beiden Fällen erreichbar: „Passwort vergessen". Dieser Weg muss
// ohne Anmeldung funktionieren — sonst hilft er genau denen nicht, für die er
// gedacht ist.
export default function LoginScreen({ mode, ready, onSimpleSignIn, onEntraSignIn }) {
  const [view, setView] = useState('login');
  const [identity, setIdentity] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [help, setHelp] = useState({ identity: '', contact: '', note: '' });
  const [helpDone, setHelpDone] = useState('');

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

  const submitHelp = async () => {
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/public/password-help', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(help)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setHelpDone(data.message);
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

        {view === 'login' && (
          <>
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

            {ready && (
              <button onClick={() => { setView('help'); setError(''); }}
                className="mt-6 inline-flex items-center gap-1.5 text-sm text-gedimmt hover:text-tinte transition-colors">
                <KeyRound size={14} /> Passwort vergessen?
              </button>
            )}
          </>
        )}

        {view === 'help' && !helpDone && (
          <div className="space-y-3 text-left">
            <p className="text-sm text-gedimmt">
              Trag deinen Anmeldenamen ein. Der IT-Support meldet sich bei dir und prüft deine
              Identität, bevor etwas zurückgesetzt wird. Hier passiert nichts automatisch.
            </p>
            <label className="block text-sm text-gedimmt">Anmeldename</label>
            <input value={help.identity} autoFocus
              onChange={(e) => setHelp({ ...help, identity: e.target.value })}
              placeholder="a.muster@bfs.de" className={field} />
            <label className="block text-sm text-gedimmt">Rückruf (optional)</label>
            <input value={help.contact}
              onChange={(e) => setHelp({ ...help, contact: e.target.value })}
              placeholder="Durchwahl oder Mobilnummer" className={field} />
            <label className="block text-sm text-gedimmt">Anmerkung (optional)</label>
            <textarea value={help.note} rows={3}
              onChange={(e) => setHelp({ ...help, note: e.target.value })}
              placeholder="z. B. Konto gesperrt seit heute früh" className={field} />
            <button onClick={submitHelp} disabled={busy || !help.identity.trim()}
              className="w-full px-6 py-2.5 bg-akzent hover:bg-akzent-hell disabled:bg-[#ddd8d1] disabled:text-leise text-white rounded font-medium text-sm transition-colors">
              {busy ? 'Wird gesendet…' : 'Hilfe anfordern'}
            </button>
            <button onClick={() => { setView('login'); setError(''); }}
              className="w-full text-sm text-leise hover:text-gedimmt transition-colors">
              Zurück
            </button>
          </div>
        )}

        {helpDone && (
          <div className="space-y-4 text-left">
            <div className="p-3 rounded bg-[#e9f5ec] border border-[#b7dcc1] text-emerald-200 text-sm">
              {helpDone}
            </div>
            <button onClick={() => { setView('login'); setHelpDone(''); setHelp({ identity: '', contact: '', note: '' }); }}
              className="w-full px-6 py-2.5 bg-flaeche hover:bg-[#ddd8d1] text-tinte rounded text-sm transition-colors">
              Zurück zur Anmeldung
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
