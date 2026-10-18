import React, { useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import { changeOwnPassword } from '../auth';

// Eigenes Passwort ändern. Das alte wird mit abgefragt — sonst genügt ein
// fremder, offen stehender Browser, um das Konto zu übernehmen.
export default function PasswordDialog({ onClose, onDone, pflicht = false }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [wieder, setWieder] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const field = 'w-full px-3 py-2 bg-white border border-linie text-tinte rounded focus:outline-none focus:ring-2 focus:ring-akzent/50';
  const vollstaendig = current && next && next === wieder;

  const speichern = async () => {
    setError('');
    if (next !== wieder) return setError('Die beiden neuen Passwörter sind nicht gleich.');
    setBusy(true);
    try {
      await changeOwnPassword(current, next);
      onDone?.();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white border border-linie rounded shadow-xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <KeyRound size={16} className="text-akzent" />
          <h2 className="font-semibold text-tinte">Passwort ändern</h2>
          {/* Bei Pflicht gibt es kein Schliessen: sonst klickt man das
              Startpasswort einfach weg und es bleibt für immer stehen. */}
          {!pflicht && (
            <button onClick={onClose} className="ml-auto text-leise hover:text-tinte" aria-label="Schließen">
              <X size={16} />
            </button>
          )}
        </div>
        <p className="text-xs text-leise mb-4">
          {pflicht
            ? 'Dein Konto hat noch das ausgelieferte Passwort. Bitte jetzt ändern.'
            : 'Andere offene Sitzungen dieses Kontos werden dabei beendet.'}
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gedimmt mb-1">Aktuelles Passwort</label>
            <input type="password" autoComplete="current-password" autoFocus value={current}
              onChange={(e) => setCurrent(e.target.value)} className={field} />
          </div>
          <div>
            <label className="block text-xs text-gedimmt mb-1">Neues Passwort</label>
            <input type="password" autoComplete="new-password" value={next}
              onChange={(e) => setNext(e.target.value)} className={field} />
          </div>
          <div>
            <label className="block text-xs text-gedimmt mb-1">Noch einmal</label>
            <input type="password" autoComplete="new-password" value={wieder}
              onChange={(e) => setWieder(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && vollstaendig && speichern()} className={field} />
          </div>
        </div>

        {error && (
          <div className="mt-3 p-2.5 rounded bg-[#fbeaea] border border-[#e8bcbc] text-[#a32020] text-xs">{error}</div>
        )}

        <div className="mt-4 flex gap-2">
          <button onClick={speichern} disabled={busy || !vollstaendig}
            className="px-4 py-2 bg-akzent hover:bg-akzent-hell disabled:bg-[#ddd8d1] disabled:text-leise text-white rounded text-sm font-medium transition-colors">
            {busy ? 'Wird gesetzt…' : 'Ändern'}
          </button>
          {!pflicht && (
            <button onClick={onClose}
              className="px-4 py-2 text-gedimmt hover:bg-flaeche border border-[#d8d4cd] rounded text-sm transition-colors">
              Abbrechen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
