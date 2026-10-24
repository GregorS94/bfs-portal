import React, { useState, useEffect } from 'react';
import { RefreshCw, Activity, Plug, Users as UsersIcon, ScrollText } from 'lucide-react';
import { authedFetch } from '../auth';
import SettingsPanel from './SettingsPanel';
import UsersPanel from './UsersPanel';
import AuditPanel from './AuditPanel';

// Administrativer Bereich, vier Reiter: Dienste, Anbindungen (die
// Schnittstellen), Konten und die Logs. Vorher war alles eine lange Seite;
// mit der Kontenverwaltung und dem Log wäre sie nicht mehr lesbar gewesen.
const TABS = [
  { id: 'dienste', label: 'Dienste', icon: Activity },
  { id: 'anbindungen', label: 'Anbindungen', icon: Plug },
  { id: 'konten', label: 'Konten', icon: UsersIcon },
  { id: 'logs', label: 'Logs', icon: ScrollText }
];

export default function AdminArea() {
  const [activeTab, setActiveTab] = useState('dienste');
  const [health, setHealth] = useState({ services: [], checkedAt: null, loading: false, error: false });

  const load = async () => {
    setHealth(h => ({ ...h, loading: true }));
    try {
      const data = await (await authedFetch('/api/health/services')).json();
      setHealth({ ...data, loading: false, error: false });
    } catch {
      setHealth({ services: [], checkedAt: null, loading: false, error: true });
    }
  };

  // Die Dienstanzeige aktualisiert sich nur, solange ihr Reiter offen ist —
  // sonst laeuft im Hintergrund alle 15 Sekunden eine Pruefung, die niemand
  // ansieht (und die bConnect und die Claude-API mit anfasst).
  useEffect(() => {
    if (activeTab !== 'dienste') return undefined;
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const bad = health.services.filter(s => s.status === 'error');
  const warn = health.services.filter(s => s.status === 'warn');

  return (
    <>
      <div className="border-b border-linie px-6 pt-3 flex gap-6 items-end bg-white">
        {TABS.map(t => {
          const Symbol = t.icon;
          const aktiv = activeTab === t.id;
          return (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-2 px-1 pb-2 -mb-px text-sm border-b-2 transition-colors ${
                aktiv
                  ? 'border-akzent text-tinte font-semibold'
                  : 'border-transparent text-gedimmt hover:text-tinte'}`}>
              <Symbol size={15} strokeWidth={1.75} />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className={activeTab === 'logs' || activeTab === 'konten' ? 'max-w-6xl' : 'max-w-3xl'}>
          {activeTab === 'konten' && <UsersPanel />}
          {activeTab === 'logs' && <AuditPanel mitKette />}

          {activeTab === 'anbindungen' && <SettingsPanel />}

          {activeTab === 'dienste' && (<>
            <div className="flex items-center gap-3 mb-4">
              <button onClick={load} className="px-4 py-2 bg-akzent hover:bg-akzent-hell text-white rounded-md transition-colors flex items-center gap-2">
                <RefreshCw size={16} className={health.loading ? 'animate-spin' : ''} /> Prüfen
              </button>
              {health.checkedAt && (
                <span className="text-sm text-leise">
                  zuletzt {new Date(health.checkedAt).toLocaleTimeString('de-DE')} · aktualisiert alle 15 s
                </span>
              )}
            </div>

            {health.error && (
              <div className="mb-4 px-4 py-3 rounded border font-semibold bg-fehler-zart border-fehler-rand text-fehler">
                Die Prüfung selbst ist fehlgeschlagen — die Liste unten sagt nichts über den Zustand der Dienste aus.
              </div>
            )}

            {health.services.length > 0 && (
              <div className={`mb-4 px-4 py-3 rounded border font-semibold ${
                bad.length ? 'bg-fehler-zart border-fehler-rand text-fehler'
                  : warn.length ? 'bg-warnung-zart border-warnung-rand text-warnung'
                  : 'bg-erfolg-zart border-erfolg-rand text-erfolg'}`}>
                {bad.length ? `${bad.length} Dienst${bad.length > 1 ? 'e' : ''} gestört`
                  : warn.length ? `${warn.length} Warnung${warn.length > 1 ? 'en' : ''}`
                  : 'Alle Dienste laufen'}
              </div>
            )}

            <div className="bg-white border border-linie rounded-xl shadow-sm overflow-hidden">
              {health.services.map(svc => {
                const dot = { ok: 'bg-erfolg', warn: 'bg-warnung', error: 'bg-fehler', off: 'bg-leise' }[svc.status];
                const label = { ok: 'OK', warn: 'Warnung', error: 'Fehler', off: 'Inaktiv' }[svc.status];
                return (
                  <div key={svc.key} className="px-4 py-3 border-b border-linie last:border-0 flex items-center gap-3">
                    <span className={`w-3 h-3 rounded-full flex-shrink-0 ${dot}`} />
                    <span className="font-medium text-tinte w-48 flex-shrink-0">{svc.name}</span>
                    <span className="text-xs font-semibold text-leise w-20 flex-shrink-0">{label}</span>
                    <span className="text-sm text-leise truncate">{svc.detail}</span>
                  </div>
                );
              })}
              {!health.services.length && !health.loading && (
                <p className="p-4 text-sm text-fehler">Status konnte nicht geladen werden — läuft das Backend?</p>
              )}
            </div>

          </>)}
        </div>
      </div>
    </>
  );
}
