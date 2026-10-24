import React, { useState, useEffect } from 'react';
import { RefreshCw, UserPlus, Lock, Unlock, Trash2, KeyRound, ShieldAlert } from 'lucide-react';
import { authedFetch } from '../auth';

// Kontenverwaltung. Alle Regeln — letzter Administrator, eigenes Konto — prüft
// das Backend; hier wird nur angezeigt, was es sagt. Doppelt zu prüfen hieße,
// zwei Wahrheiten zu pflegen.
const ROLE_LABEL = { user: 'Mitarbeiter', it: 'IT-Support', admin: 'Administrator' };

export default function UsersPanel() {
  const [state, setState] = useState({ users: [], defaultsPending: [], loading: true, error: null });
  const [neu, setNeu] = useState({ username: '', password: '', role: 'user', displayName: '' });
  const [formOffen, setFormOffen] = useState(false);
  const [meldung, setMeldung] = useState(null);

  const load = async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const res = await authedFetch('/api/admin/users');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setState({ users: data.users, defaultsPending: data.defaultsPending || [], loading: false, error: null });
    } catch (err) {
      setState({ users: [], defaultsPending: [], loading: false, error: err.message });
    }
  };

  useEffect(() => { load(); }, []);

  /** Ein Aufruf, ein Ergebnis, eine Meldung. Fehler bleiben stehen, bis der
   *  nächste Versuch läuft — sonst verschwindet die Begründung zu schnell. */
  const ruf = async (pfad, options, erfolg) => {
    setMeldung(null);
    try {
      const res = await authedFetch(pfad, options);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMeldung({ ok: true, text: erfolg });
      await load();
      return true;
    } catch (err) {
      setMeldung({ ok: false, text: err.message });
      return false;
    }
  };

  const anlegen = async () => {
    const ok = await ruf('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(neu)
    }, `Konto „${neu.username}" angelegt.`);
    if (ok) {
      setNeu({ username: '', password: '', role: 'user', displayName: '' });
      setFormOffen(false);
    }
  };

  const aendern = (konto, patch, text) => ruf(`/api/admin/users/${konto.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  }, text);

  const passwortSetzen = async (konto) => {
    // Bewusst ein Browser-Dialog: ein eigenes Formular dafür wäre mehr
    // Oberfläche für denselben Vorgang.
    const wort = window.prompt(`Neues Passwort für „${konto.username}"\n\nEs gilt als vorläufig — ${konto.username} muss es beim nächsten Anmelden ändern.`);
    if (!wort) return;
    await ruf(`/api/admin/users/${konto.id}/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: wort })
    }, `Passwort für „${konto.username}" gesetzt.`);
  };

  const loeschen = async (konto) => {
    if (!window.confirm(`Konto „${konto.username}" wirklich löschen?`)) return;
    await ruf(`/api/admin/users/${konto.id}`, { method: 'DELETE' }, `Konto „${konto.username}" gelöscht.`);
  };

  const field = 'px-3 py-2 bg-white border border-linie text-tinte rounded text-sm focus:outline-none focus:ring-2 focus:ring-akzent/50';

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <button onClick={() => setFormOffen((o) => !o)}
          className="px-4 py-2 bg-akzent hover:bg-akzent-hell text-white rounded-md text-sm transition-colors flex items-center gap-2">
          <UserPlus size={15} /> Konto anlegen
        </button>
        <button onClick={load}
          className="px-3 py-2 text-gedimmt hover:bg-flaeche border border-linie rounded-md text-sm transition-colors flex items-center gap-2">
          <RefreshCw size={14} className={state.loading ? 'animate-spin' : ''} /> Aktualisieren
        </button>
      </div>

      {state.defaultsPending.length > 0 && (
        <div className="mb-3 flex gap-2 items-start p-3 rounded bg-warnung-zart border border-warnung-rand text-warnung text-xs">
          <ShieldAlert size={16} className="shrink-0 mt-0.5" />
          <span>
            Mit ausgeliefertem Passwort: <strong>{state.defaultsPending.join(', ')}</strong>.
            Diese Passwörter stehen in der Dokumentation und gelten damit als öffentlich bekannt.
          </span>
        </div>
      )}

      {formOffen && (
        <div className="mb-4 p-4 bg-white border border-linie rounded">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gedimmt mb-1">Anmeldename</label>
              <input value={neu.username} onChange={(e) => setNeu({ ...neu, username: e.target.value })}
                placeholder="a.muster@bfs.de" className={`${field} w-full`} />
            </div>
            <div>
              <label className="block text-xs text-gedimmt mb-1">Anzeigename</label>
              <input value={neu.displayName} onChange={(e) => setNeu({ ...neu, displayName: e.target.value })}
                placeholder="Anna Muster" className={`${field} w-full`} />
            </div>
            <div>
              <label className="block text-xs text-gedimmt mb-1">Passwort</label>
              <input value={neu.password} type="password" autoComplete="new-password"
                onChange={(e) => setNeu({ ...neu, password: e.target.value })} className={`${field} w-full`} />
            </div>
            <div>
              <label className="block text-xs text-gedimmt mb-1">Rolle</label>
              <select value={neu.role} onChange={(e) => setNeu({ ...neu, role: e.target.value })} className={`${field} w-full`}>
                {Object.entries(ROLE_LABEL).map(([wert, text]) => (
                  <option key={wert} value={wert}>{text}</option>
                ))}
              </select>
            </div>
          </div>
          <button onClick={anlegen} disabled={!neu.username || !neu.password}
            className="mt-3 px-4 py-2 bg-akzent hover:bg-akzent-hell disabled:bg-linie disabled:text-leise text-white rounded-md text-sm transition-colors">
            Anlegen
          </button>
        </div>
      )}

      {meldung && (
        <div className={`mb-3 p-3 rounded border text-sm ${meldung.ok
          ? 'bg-erfolg-zart border-erfolg-rand text-erfolg'
          : 'bg-fehler-zart border-fehler-rand text-fehler'}`}>
          {meldung.text}
        </div>
      )}

      {state.error && (
        <div className="mb-3 p-3 rounded border bg-fehler-zart border-fehler-rand text-fehler text-sm">{state.error}</div>
      )}

      <div className="bg-white border border-linie rounded-xl shadow-sm overflow-hidden">
        {state.users.map((u) => (
          <div key={u.id} className="px-4 py-3 border-b border-linie last:border-0 flex items-center gap-3 flex-wrap">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${u.active ? 'bg-erfolg' : 'bg-linie'}`} />
            <span className="font-medium text-tinte w-48 truncate">{u.username}</span>
            <span className="text-sm text-leise w-40 truncate">{u.displayName}</span>

            <select value={u.role}
              onChange={(e) => aendern(u, { role: e.target.value }, `Rolle von „${u.username}" ist jetzt ${ROLE_LABEL[e.target.value]}.`)}
              className="px-2 py-1 text-xs bg-white border border-linie rounded">
              {Object.entries(ROLE_LABEL).map(([wert, text]) => (
                <option key={wert} value={wert}>{text}</option>
              ))}
            </select>

            {u.mustChange && (
              // Hinweis, kein Zwang: die Startpasswoerter sind fest. Sichtbar
              // bleibt es, damit beim Umzug in den Betrieb niemand uebersieht,
              // dass `admin/admin` noch gilt.
              <span title="Dieses Konto hat noch das ausgelieferte Passwort. Niemand muss es ändern — gut zu wissen ist es trotzdem."
                className="text-[10px] uppercase font-semibold tracking-wide text-warnung bg-warnung-zart ring-1 ring-warnung-rand rounded px-1.5 py-0.5">
                Startpasswort
              </span>
            )}
            <span className="text-xs text-leise ml-auto whitespace-nowrap">
              {u.lastLoginAt ? `zuletzt ${new Date(u.lastLoginAt).toLocaleString('de-DE')}` : 'noch nie angemeldet'}
            </span>

            <div className="flex gap-1">
              <button onClick={() => passwortSetzen(u)} title="Passwort setzen"
                className="p-2 text-gedimmt hover:text-tinte hover:bg-flaeche rounded transition-colors">
                <KeyRound size={15} />
              </button>
              <button onClick={() => aendern(u, { active: !u.active }, `„${u.username}" ist jetzt ${u.active ? 'gesperrt' : 'entsperrt'}.`)}
                title={u.active ? 'Sperren' : 'Entsperren'}
                className="p-2 text-gedimmt hover:text-tinte hover:bg-flaeche rounded transition-colors">
                {u.active ? <Lock size={15} /> : <Unlock size={15} />}
              </button>
              <button onClick={() => loeschen(u)} title="Löschen"
                className="p-2 text-gedimmt hover:text-fehler hover:bg-flaeche rounded transition-colors">
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
        {!state.users.length && !state.loading && !state.error && (
          <p className="p-4 text-sm text-leise">Keine Konten.</p>
        )}
      </div>
    </div>
  );
}
