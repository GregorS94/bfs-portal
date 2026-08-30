import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { authedFetch } from '../auth';
import SettingsPanel from './SettingsPanel';

// Administrativer Bereich: Zustand der Dienste und der Konfiguration.
export default function AdminArea() {
  const [health, setHealth] = useState({ services: [], checkedAt: null, loading: false });

  const load = async () => {
    setHealth(h => ({ ...h, loading: true }));
    try {
      const data = await (await authedFetch('/api/health/services')).json();
      setHealth({ ...data, loading: false });
    } catch {
      setHealth({ services: [], checkedAt: null, loading: false, error: true });
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);

  const bad = health.services.filter(s => s.status === 'error');
  const warn = health.services.filter(s => s.status === 'warn');

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={load} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-colors flex items-center gap-2">
            <RefreshCw size={16} className={health.loading ? 'animate-spin' : ''} /> Prüfen
          </button>
          {health.checkedAt && (
            <span className="text-sm text-slate-500">
              zuletzt {new Date(health.checkedAt).toLocaleTimeString('de-DE')} · aktualisiert alle 15 s
            </span>
          )}
        </div>

        {health.services.length > 0 && (
          <div className={`mb-4 px-4 py-3 rounded-xl border font-semibold ${
            bad.length ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              : warn.length ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'}`}>
            {bad.length ? `${bad.length} Dienst${bad.length > 1 ? 'e' : ''} gestört`
              : warn.length ? `${warn.length} Warnung${warn.length > 1 ? 'en' : ''}`
              : 'Alle Dienste laufen'}
          </div>
        )}

        <div className="bg-[#131a27] border border-slate-800 rounded-xl overflow-hidden">
          {health.services.map(svc => {
            const dot = { ok: 'bg-emerald-500', warn: 'bg-amber-500', error: 'bg-rose-500', off: 'bg-slate-700' }[svc.status];
            const label = { ok: 'OK', warn: 'Warnung', error: 'Fehler', off: 'Inaktiv' }[svc.status];
            return (
              <div key={svc.key} className="px-4 py-3 border-b border-slate-800/70 last:border-0 flex items-center gap-3">
                <span className={`w-3 h-3 rounded-full flex-shrink-0 ${dot}`} />
                <span className="font-medium text-slate-100 w-48 flex-shrink-0">{svc.name}</span>
                <span className="text-xs font-bold text-slate-500 w-20 flex-shrink-0">{label}</span>
                <span className="text-sm text-slate-500 truncate">{svc.detail}</span>
              </div>
            );
          })}
          {!health.services.length && !health.loading && (
            <p className="p-4 text-sm text-rose-400">Status konnte nicht geladen werden — läuft das Backend?</p>
          )}
        </div>

        <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Anbindungen
        </h2>
        <SettingsPanel />
      </div>
    </div>
  );
}
