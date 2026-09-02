import React, { useState, useEffect } from 'react';
import { Save, PlugZap, Check, X, Loader2 } from 'lucide-react';
import { authedFetch } from '../auth';

// Anbindungen eintragen: Atlassian und Entra.
//
// Geheimnisse kommen nie vom Server zurück — das Formular weiß nur, ob eines
// hinterlegt ist. Ein leer gelassenes Geheimnisfeld bedeutet deshalb „nicht
// anfassen"; zum Entfernen gibt es einen eigenen Knopf.
const GROUPS = [
  {
    key: 'atlassian',
    title: 'Atlassian — Confluence & Jira',
    hint: 'API-Token unter id.atlassian.com → Security. Das technische Konto braucht ' +
      'in Jira „Vorgänge erstellen" im Zielprojekt und in Confluence Leserechte.'
  },
  {
    key: 'entra',
    title: 'Microsoft Entra',
    hint: 'App-Registrierung mit Anwendungsberechtigung AuditLog.Read.All und ' +
      'Administrator-Zustimmung. Die beiden Adressfelder bleiben normalerweise leer.'
  }
];

export default function SettingsPanel() {
  const [data, setData] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState({});

  const load = async () => {
    try {
      const json = await (await authedFetch('/api/admin/settings')).json();
      setData(json);
      setDrafts({});
    } catch {
      setData({ error: true });
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setDraft = (group, key, value) =>
    setDrafts(d => ({ ...d, [group]: { ...(d[group] || {}), [key]: value } }));

  const save = async (group) => {
    setBusy(`save:${group}`);
    setResult(r => ({ ...r, [group]: null }));
    try {
      const res = await authedFetch(`/api/admin/settings/${group}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(drafts[group] || {})
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Speichern fehlgeschlagen');
      setResult(r => ({ ...r, [group]: { ok: true, detail: 'Gespeichert.' } }));
      await load();
    } catch (err) {
      setResult(r => ({ ...r, [group]: { ok: false, detail: err.message } }));
    } finally {
      setBusy('');
    }
  };

  const test = async (group) => {
    setBusy(`test:${group}`);
    setResult(r => ({ ...r, [group]: null }));
    try {
      const json = await (await authedFetch(`/api/admin/settings/${group}/test`, { method: 'POST' })).json();
      setResult(r => ({ ...r, [group]: { ok: json.ok, detail: json.detail || json.error } }));
    } catch (err) {
      setResult(r => ({ ...r, [group]: { ok: false, detail: err.message } }));
    } finally {
      setBusy('');
    }
  };

  const clearSecret = async (group, key) => {
    setBusy(`save:${group}`);
    try {
      await authedFetch(`/api/admin/settings/${group}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: null })
      });
      await load();
    } finally {
      setBusy('');
    }
  };

  if (!data) return <div className="text-leise text-sm">Einstellungen werden geladen…</div>;
  if (data.error) return <div className="text-[#a32020] text-sm">Einstellungen konnten nicht geladen werden.</div>;

  return (
    <div className="space-y-4">
      {GROUPS.map(({ key: group, title, hint }) => {
        const view = data.settings[group];
        if (!view) return null;
        const ready = group === 'atlassian' ? data.ready.atlassian : data.ready.entra;
        const res = result[group];

        return (
          <section key={group} className="bg-white border border-linie rounded p-5">
            <div className="flex items-center gap-3 mb-1">
              <h3 className="font-semibold text-tinte">{title}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full ${ready
                ? 'bg-[#e9f5ec] text-[#1f6b39] border border-[#b7dcc1]'
                : 'bg-flaeche text-gedimmt border border-[#d8d4cd]'}`}>
                {ready ? 'verbunden' : 'unvollständig'}
              </span>
            </div>
            <p className="text-xs text-leise mb-4 leading-relaxed">{hint}</p>

            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(view.fields).map(([key, field]) => (
                <label key={key} className="block">
                  <span className="block text-xs text-gedimmt mb-1">{field.label}</span>
                  <input
                    type="text"
                    defaultValue={field.value}
                    onChange={e => setDraft(group, key, e.target.value)}
                    className="w-full px-3 py-2 bg-flaeche border border-linie rounded
                               text-tinte text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </label>
              ))}

              {Object.entries(view.secrets).map(([key, secret]) => (
                <label key={key} className="block">
                  <span className="block text-xs text-gedimmt mb-1">
                    {secret.label}
                    {secret.set && (
                      <>
                        <span className="text-emerald-400"> · hinterlegt</span>
                        <button
                          type="button"
                          onClick={() => clearSecret(group, key)}
                          className="ml-2 text-leise hover:text-[#a32020] underline"
                        >
                          entfernen
                        </button>
                      </>
                    )}
                  </span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder={secret.set ? 'unverändert lassen' : 'noch nicht hinterlegt'}
                    onChange={e => setDraft(group, key, e.target.value)}
                    className="w-full px-3 py-2 bg-flaeche border border-linie rounded
                               text-tinte text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </label>
              ))}
            </div>

            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={() => save(group)}
                disabled={busy.startsWith('save')}
                className="px-4 py-2 bg-akzent hover:bg-akzent-hell disabled:opacity-50
                           text-white rounded text-sm flex items-center gap-2 transition-colors"
              >
                {busy === `save:${group}` ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                Speichern
              </button>
              <button
                onClick={() => test(group)}
                disabled={busy.startsWith('test')}
                className="px-4 py-2 bg-flaeche hover:bg-[#ddd8d1] disabled:opacity-50
                           text-tinte rounded text-sm flex items-center gap-2 transition-colors"
              >
                {busy === `test:${group}` ? <Loader2 size={15} className="animate-spin" /> : <PlugZap size={15} />}
                Verbindung prüfen
              </button>

              {res && (
                <span className={`text-sm flex items-center gap-1.5 ${res.ok ? 'text-[#1f6b39]' : 'text-[#a32020]'}`}>
                  {res.ok ? <Check size={15} /> : <X size={15} />} {res.detail}
                </span>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
