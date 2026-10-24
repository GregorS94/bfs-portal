import React, { useState, useEffect } from 'react';
import { RefreshCw, ShieldAlert, ClipboardList, Wrench, ScrollText, Package } from 'lucide-react';
import { authedFetch } from '../auth';
import AuditPanel from './AuditPanel';
import KioskApprovals from './KioskApprovals';
import Statuspille from '../Statuspille';

// IT-Bereich: Geräte, offene Freigaben, Auftragsverlauf, Audit-Log.
// Bewusst ohne Chat — der ITler arbeitet hier an Aufträgen, nicht am Dialog.
export default function ITArea() {
  const [activeTab, setActiveTab] = useState('jobs');
  const [devices, setDevices] = useState({ list: [], loading: false, error: null });
  const [jobs, setJobs] = useState({ list: [], loading: false, error: null });

  const loadDevices = async () => {
    setDevices(d => ({ ...d, loading: true }));
    const data = await (await authedFetch('/api/devices')).json();
    setDevices({ list: data.devices || [], loading: false, error: data.error || null });
  };

  const loadJobs = async () => {
    setJobs(j => ({ ...j, loading: true }));
    const data = await (await authedFetch('/api/jobs')).json();
    setJobs({ list: data.jobs || [], loading: false, error: data.error || null });
  };

  const decide = async (jobId, approve) => {
    await authedFetch(`/api/jobs/${jobId}/${approve ? 'approve' : 'deny'}`, { method: 'POST' });
    loadJobs();
  };

  useEffect(() => {
    if (activeTab === 'devices') loadDevices();
    if (activeTab === 'jobs') loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const TABS = [
    { id: 'jobs', label: 'Aufträge', icon: ClipboardList },
    { id: 'devices', label: 'Geräte', icon: Wrench },
    { id: 'kiosk', label: 'Software-Freigaben', icon: Package },
    { id: 'audit', label: 'Audit-Log', icon: ScrollText }
  ];

  const pending = jobs.list.filter(j => j.status === 'awaiting_approval');
  // Auftragszustände auf die fünf Töne der Statuspille abgebildet. 'queued' und
  // 'running' sind beide „in Bearbeitung" — für den Lesenden ist der
  // Unterschied zwischen „wartet in der Schlange" und „läuft gerade" bedeutungslos.
  const STATUS_TON = {
    awaiting_approval: 'warten',
    queued: 'laeuft',
    running: 'laeuft',
    done: 'fertig',
    error: 'fehler',
    denied: 'ruhend'
  };

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
            {t.id === 'jobs' && pending.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 bg-akzent text-white rounded text-[10px] font-semibold">{pending.length}</span>
            )}
          </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'jobs' && (
          <div>
            <button onClick={loadJobs} className="mb-4 px-4 py-2 bg-akzent hover:bg-akzent-hell text-white rounded-md transition-colors flex items-center gap-2">
              <RefreshCw size={16} className={jobs.loading ? 'animate-spin' : ''} /> Aktualisieren
            </button>
            {jobs.error && <p className="text-fehler text-sm mb-4">{jobs.error}</p>}

            {pending.length > 0 && (
              <div className="mb-6">
                <h3 className="font-semibold text-tinte mb-2 flex items-center gap-2">
                  <ShieldAlert size={18} className="text-warnung" /> Wartet auf Freigabe
                </h3>
                {pending.map(j => (
                  <div key={j.id} className="bg-warnung-zart border border-warnung-rand rounded-xl p-4 mb-2 rise-in">
                    <p className="text-sm text-warnung">
                      <span className="font-mono font-semibold">{j.action}</span>
                      {' '}auf <span className="font-semibold">{j.deviceId}</span>
                      {' '}· angefordert von {j.requestedBy}
                    </p>
                    {Object.keys(j.params || {}).length > 0 && (
                      <pre className="text-xs bg-white border border-warnung-rand rounded p-2 my-2">{JSON.stringify(j.params)}</pre>
                    )}
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => decide(j.id, true)} className="px-3.5 py-1.5 bg-akzent hover:bg-akzent-hell text-white rounded-md text-sm font-medium transition-colors">Freigeben</button>
                      <button onClick={() => decide(j.id, false)} className="px-3.5 py-1.5 text-gedimmt border border-linie hover:bg-flaeche rounded-md text-sm transition-colors">Ablehnen</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <h3 className="text-sm font-semibold text-tinte mb-2">Verlauf</h3>
            <div className="bg-white border border-linie rounded-xl shadow-sm overflow-hidden">
              {jobs.list.length === 0 && !jobs.error && <p className="p-4 text-sm text-gedimmt">Noch keine Aufträge.</p>}
              {jobs.list.map(j => (
                <div key={j.id} className="px-4 h-12 border-b border-linie last:border-0 flex items-center gap-3 text-sm">
                  <Statuspille ton={STATUS_TON[j.status]}>{j.status}</Statuspille>
                  <span className="font-mono text-tinte">{j.action}</span>
                  <span className="text-gedimmt">{j.deviceId}</span>
                  <span className="text-gedimmt text-xs ml-auto zahlen">
                    {new Date(j.createdAt).toLocaleTimeString('de-DE')}
                    {j.approvedBy ? ` · freigegeben von ${j.approvedBy}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'devices' && (
          <div>
            <button onClick={loadDevices} className="mb-4 px-4 py-2 bg-akzent hover:bg-akzent-hell text-white rounded-md transition-colors">
              <><RefreshCw size={14} className={devices.loading ? 'animate-spin' : ''} /> Aktualisieren</>
            </button>
            {devices.error && <p className="text-fehler text-sm">{devices.error}</p>}
            {devices.list.length === 0 && !devices.loading && !devices.error && (
              <p className="text-leise text-sm">Kein Gerät verbunden — läuft der Agent?</p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {devices.list.map(d => (
                <div key={d.deviceId} className="bg-white p-4 rounded-xl shadow-sm border border-linie hover:border-akzent-rand transition-colors">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${d.online ? 'bg-erfolg' : 'bg-linie'}`} />
                    <h3 className="font-semibold text-tinte">{d.hostname}</h3>
                    <span className="text-[10px] uppercase font-semibold text-leise ml-auto">{d.driver}</span>
                  </div>
                  <p className="text-sm text-leise">{d.platform} · {d.osVersion}</p>
                  <p className="text-xs text-leise mt-2">zuletzt gesehen: {new Date(d.lastSeen).toLocaleTimeString('de-DE')}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'kiosk' && <KioskApprovals />}

        {activeTab === 'audit' && <AuditPanel />}
      </div>
    </>
  );
}
