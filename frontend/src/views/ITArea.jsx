import React, { useState, useEffect } from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import { authedFetch } from '../auth';

// IT-Bereich: Geräte, offene Freigaben, Auftragsverlauf, Audit-Log.
// Bewusst ohne Chat — der ITler arbeitet hier an Aufträgen, nicht am Dialog.
export default function ITArea() {
  const [activeTab, setActiveTab] = useState('jobs');
  const [devices, setDevices] = useState({ list: [], loading: false, error: null });
  const [jobs, setJobs] = useState({ list: [], loading: false, error: null });
  const [audit, setAudit] = useState({ entries: [], loading: false, error: null });
  const [pwHelp, setPwHelp] = useState({ list: [], loading: false, error: null });

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

  const loadAudit = async () => {
    setAudit(a => ({ ...a, loading: true }));
    const data = await (await authedFetch('/api/audit')).json();
    setAudit({ entries: data.entries || [], loading: false, error: data.error || null });
  };

  const loadPwHelp = async () => {
    setPwHelp(h => ({ ...h, loading: true }));
    const data = await (await authedFetch('/api/password-requests')).json();
    setPwHelp({ list: data.requests || [], loading: false, error: data.error || null });
  };

  const closePwHelp = async (id) => {
    await authedFetch(`/api/password-requests/${id}/close`, { method: 'POST' });
    loadPwHelp();
  };

  const decide = async (jobId, approve) => {
    await authedFetch(`/api/jobs/${jobId}/${approve ? 'approve' : 'deny'}`, { method: 'POST' });
    loadJobs();
  };

  useEffect(() => {
    if (activeTab === 'devices') loadDevices();
    if (activeTab === 'jobs') loadJobs();
    if (activeTab === 'audit') loadAudit();
    if (activeTab === 'pwhelp') loadPwHelp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const TABS = [
    { id: 'jobs', label: '📋 Aufträge' },
    { id: 'devices', label: '🔧 Geräte' },
    { id: 'pwhelp', label: '🔑 Passwort-Hilfe' },
    { id: 'audit', label: '📜 Audit-Log' }
  ];

  const pending = jobs.list.filter(j => j.status === 'awaiting_approval');
  const STATUS_STYLE = {
    awaiting_approval: 'bg-amber-500/15 text-amber-300',
    done: 'bg-emerald-500/15 text-emerald-300',
    error: 'bg-rose-500/15 text-rose-300',
    denied: 'bg-slate-200 text-slate-300'
  };

  return (
    <>
      <div className="border-b border-slate-800 px-6 py-3 flex gap-1 items-center">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-3.5 py-1.5 rounded-lg text-sm transition-colors ${
              activeTab === t.id
                ? 'bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-500/25'
                : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'}`}>
            {t.label}
            {t.id === 'jobs' && pending.length > 0 && (
              <span className="ml-2 px-1.5 py-0.5 bg-amber-500 text-white rounded text-[10px] font-bold">{pending.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'jobs' && (
          <div>
            <button onClick={loadJobs} className="mb-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-colors flex items-center gap-2">
              <RefreshCw size={16} className={jobs.loading ? 'animate-spin' : ''} /> Aktualisieren
            </button>
            {jobs.error && <p className="text-rose-400 text-sm mb-4">{jobs.error}</p>}

            {pending.length > 0 && (
              <div className="mb-6">
                <h3 className="font-bold text-slate-100 mb-2 flex items-center gap-2">
                  <ShieldAlert size={18} className="text-amber-400" /> Wartet auf Freigabe
                </h3>
                {pending.map(j => (
                  <div key={j.id} className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-2 rise-in">
                    <p className="text-sm text-amber-200">
                      <span className="font-mono font-bold">{j.action}</span>
                      {' '}auf <span className="font-bold">{j.deviceId}</span>
                      {' '}· angefordert von {j.requestedBy}
                    </p>
                    {Object.keys(j.params || {}).length > 0 && (
                      <pre className="text-xs bg-[#131a27] border border-amber-500/30 rounded p-2 my-2">{JSON.stringify(j.params)}</pre>
                    )}
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => decide(j.id, true)} className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-sm font-medium transition-colors">Freigeben</button>
                      <button onClick={() => decide(j.id, false)} className="px-3.5 py-1.5 text-slate-300 border border-slate-700 hover:bg-slate-800 rounded-xl text-sm transition-colors">Ablehnen</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <h3 className="font-bold text-slate-100 mb-2">Verlauf</h3>
            <div className="bg-[#131a27] border border-slate-800 rounded-xl overflow-hidden">
              {jobs.list.length === 0 && !jobs.error && <p className="p-4 text-sm text-slate-500">Noch keine Aufträge.</p>}
              {jobs.list.map(j => (
                <div key={j.id} className="px-4 py-2 border-b border-slate-800/70 last:border-0 flex items-center gap-3 text-sm">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${STATUS_STYLE[j.status] || 'bg-[#0b0f16] text-slate-300'}`}>{j.status}</span>
                  <span className="font-mono text-slate-200">{j.action}</span>
                  <span className="text-slate-500">{j.deviceId}</span>
                  <span className="text-slate-500 text-xs ml-auto">
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
            <button onClick={loadDevices} className="mb-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-colors">
              {devices.loading ? '⏳' : '🔄 Aktualisieren'}
            </button>
            {devices.error && <p className="text-rose-400 text-sm">{devices.error}</p>}
            {devices.list.length === 0 && !devices.loading && !devices.error && (
              <p className="text-slate-500 text-sm">Kein Gerät verbunden — läuft der Agent?</p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {devices.list.map(d => (
                <div key={d.deviceId} className="bg-[#131a27] p-4 rounded-xl border border-slate-800 hover:border-slate-700 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${d.online ? 'bg-emerald-500' : 'bg-slate-700'}`} />
                    <h3 className="font-bold text-slate-100">{d.hostname}</h3>
                    <span className="text-[10px] uppercase font-bold text-slate-500 ml-auto">{d.driver}</span>
                  </div>
                  <p className="text-sm text-slate-500">{d.platform} · {d.osVersion}</p>
                  <p className="text-xs text-slate-500 mt-2">zuletzt gesehen: {new Date(d.lastSeen).toLocaleTimeString('de-DE')}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'pwhelp' && (
          <div>
            <div className="flex items-start gap-2 mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm">
              <ShieldAlert size={18} className="shrink-0 mt-0.5" />
              <span>
                Diese Anfragen kommen ohne Anmeldung herein — die Kennung ist <strong>behauptet, nicht geprüft</strong>.
                Identität telefonisch oder persönlich prüfen, erst danach zurücksetzen.
              </span>
            </div>
            <button onClick={loadPwHelp} className="mb-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-colors">
              {pwHelp.loading ? '⏳' : '🔄 Aktualisieren'}
            </button>
            <div className="bg-[#131a27] border border-slate-800 rounded-xl overflow-hidden">
              {pwHelp.error && <p className="p-4 text-sm text-rose-400">{pwHelp.error}</p>}
              {pwHelp.list.length === 0 && !pwHelp.error && <p className="p-4 text-sm text-slate-500">Keine offenen Anfragen.</p>}
              {pwHelp.list.map(r => (
                <div key={r.id} className="px-4 py-3 border-b border-slate-800/70 last:border-0 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-200 font-mono">{r.identity}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {new Date(r.createdAt).toLocaleString('de-DE')} · {r.source === 'public' ? 'Anmeldebildschirm' : 'aus dem Portal'}
                      {r.contact && ` · Rückruf: ${r.contact}`}
                      {r.ticket && ` · ${r.ticket.key}`}
                    </p>
                    {r.note && <p className="text-sm text-slate-400 mt-1">{r.note}</p>}
                  </div>
                  {r.status === 'open' ? (
                    <button onClick={() => closePwHelp(r.id)}
                      className="px-3 py-1.5 border border-slate-700 text-slate-300 hover:bg-slate-800 rounded-xl text-sm transition-colors whitespace-nowrap">
                      Erledigt
                    </button>
                  ) : (
                    <span className="text-xs text-slate-500 whitespace-nowrap">
                      erledigt von {r.closedBy}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'audit' && (
          <div>
            <button onClick={loadAudit} className="mb-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-colors">
              {audit.loading ? '⏳' : '🔄 Aktualisieren'}
            </button>
            <div className="bg-[#131a27] border border-slate-800 rounded-xl overflow-hidden">
              {audit.error && <p className="p-4 text-sm text-rose-400">{audit.error}</p>}
              {audit.entries.length === 0 && !audit.error && <p className="p-4 text-sm text-slate-500">Noch keine Einträge.</p>}
              {audit.entries.map((e, i) => (
                <div key={i} className="px-4 py-2 border-b border-slate-800/70 last:border-0 text-sm flex gap-3">
                  <span className="text-slate-500 font-mono text-xs whitespace-nowrap">{new Date(e.ts).toLocaleString('de-DE')}</span>
                  <span className="font-mono text-xs font-bold text-slate-300 whitespace-nowrap">{e.event}</span>
                  <span className="text-slate-500 truncate">
                    {e.action || e.hostname || ''} {e.params ? JSON.stringify(e.params) : ''} {e.approvedBy ? `· freigegeben von ${e.approvedBy}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
