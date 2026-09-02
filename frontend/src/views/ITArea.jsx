import React, { useState, useEffect } from 'react';
import { RefreshCw, ShieldAlert, ClipboardList, Wrench, KeyRound, ScrollText } from 'lucide-react';
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
    { id: 'jobs', label: 'Aufträge', icon: ClipboardList },
    { id: 'devices', label: 'Geräte', icon: Wrench },
    { id: 'pwhelp', label: 'Passwort-Hilfe', icon: KeyRound },
    { id: 'audit', label: 'Audit-Log', icon: ScrollText }
  ];

  const pending = jobs.list.filter(j => j.status === 'awaiting_approval');
  const STATUS_STYLE = {
    awaiting_approval: 'bg-amber-500/15 text-[#8a5200]',
    done: 'bg-emerald-500/15 text-[#1f6b39]',
    error: 'bg-rose-500/15 text-[#a32020]',
    denied: 'bg-slate-200 text-gedimmt'
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
              <span className="ml-1 px-1.5 py-0.5 bg-akzent text-white rounded text-[10px] font-bold">{pending.length}</span>
            )}
          </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'jobs' && (
          <div>
            <button onClick={loadJobs} className="mb-4 px-4 py-2 bg-akzent hover:bg-akzent-hell text-white rounded transition-colors flex items-center gap-2">
              <RefreshCw size={16} className={jobs.loading ? 'animate-spin' : ''} /> Aktualisieren
            </button>
            {jobs.error && <p className="text-[#a32020] text-sm mb-4">{jobs.error}</p>}

            {pending.length > 0 && (
              <div className="mb-6">
                <h3 className="font-bold text-tinte mb-2 flex items-center gap-2">
                  <ShieldAlert size={18} className="text-amber-400" /> Wartet auf Freigabe
                </h3>
                {pending.map(j => (
                  <div key={j.id} className="bg-[#fdf3e2] border border-[#e9c98f] rounded p-4 mb-2 rise-in">
                    <p className="text-sm text-[#8a5200]">
                      <span className="font-mono font-bold">{j.action}</span>
                      {' '}auf <span className="font-bold">{j.deviceId}</span>
                      {' '}· angefordert von {j.requestedBy}
                    </p>
                    {Object.keys(j.params || {}).length > 0 && (
                      <pre className="text-xs bg-white border border-[#e9c98f] rounded p-2 my-2">{JSON.stringify(j.params)}</pre>
                    )}
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => decide(j.id, true)} className="px-3.5 py-1.5 bg-akzent hover:bg-akzent-hell text-white rounded text-sm font-medium transition-colors">Freigeben</button>
                      <button onClick={() => decide(j.id, false)} className="px-3.5 py-1.5 text-gedimmt border border-[#d8d4cd] hover:bg-flaeche rounded text-sm transition-colors">Ablehnen</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <h3 className="font-bold text-tinte mb-2">Verlauf</h3>
            <div className="bg-white border border-linie rounded overflow-hidden">
              {jobs.list.length === 0 && !jobs.error && <p className="p-4 text-sm text-leise">Noch keine Aufträge.</p>}
              {jobs.list.map(j => (
                <div key={j.id} className="px-4 py-2 border-b border-linie last:border-0 flex items-center gap-3 text-sm">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${STATUS_STYLE[j.status] || 'bg-flaeche text-gedimmt'}`}>{j.status}</span>
                  <span className="font-mono text-tinte">{j.action}</span>
                  <span className="text-leise">{j.deviceId}</span>
                  <span className="text-leise text-xs ml-auto">
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
            <button onClick={loadDevices} className="mb-4 px-4 py-2 bg-akzent hover:bg-akzent-hell text-white rounded transition-colors">
              <><RefreshCw size={14} className={devices.loading ? 'animate-spin' : ''} /> Aktualisieren</>
            </button>
            {devices.error && <p className="text-[#a32020] text-sm">{devices.error}</p>}
            {devices.list.length === 0 && !devices.loading && !devices.error && (
              <p className="text-leise text-sm">Kein Gerät verbunden — läuft der Agent?</p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {devices.list.map(d => (
                <div key={d.deviceId} className="bg-white p-4 rounded border border-linie hover:border-[#d8d4cd] transition-colors">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${d.online ? 'bg-emerald-500' : 'bg-[#ddd8d1]'}`} />
                    <h3 className="font-bold text-tinte">{d.hostname}</h3>
                    <span className="text-[10px] uppercase font-bold text-leise ml-auto">{d.driver}</span>
                  </div>
                  <p className="text-sm text-leise">{d.platform} · {d.osVersion}</p>
                  <p className="text-xs text-leise mt-2">zuletzt gesehen: {new Date(d.lastSeen).toLocaleTimeString('de-DE')}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'pwhelp' && (
          <div>
            <div className="flex items-start gap-2 mb-4 p-3 rounded bg-[#fdf3e2] border border-[#e9c98f] text-[#8a5200] text-sm">
              <ShieldAlert size={18} className="shrink-0 mt-0.5" />
              <span>
                Diese Anfragen kommen ohne Anmeldung herein — die Kennung ist <strong>behauptet, nicht geprüft</strong>.
                Identität telefonisch oder persönlich prüfen, erst danach zurücksetzen.
              </span>
            </div>
            <button onClick={loadPwHelp} className="mb-4 px-4 py-2 bg-akzent hover:bg-akzent-hell text-white rounded transition-colors">
              <><RefreshCw size={14} className={pwHelp.loading ? 'animate-spin' : ''} /> Aktualisieren</>
            </button>
            <div className="bg-white border border-linie rounded overflow-hidden">
              {pwHelp.error && <p className="p-4 text-sm text-[#a32020]">{pwHelp.error}</p>}
              {pwHelp.list.length === 0 && !pwHelp.error && <p className="p-4 text-sm text-leise">Keine offenen Anfragen.</p>}
              {pwHelp.list.map(r => (
                <div key={r.id} className="px-4 py-3 border-b border-linie last:border-0 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-tinte font-mono">{r.identity}</p>
                    <p className="text-xs text-leise mt-0.5">
                      {new Date(r.createdAt).toLocaleString('de-DE')} · {r.source === 'public' ? 'Anmeldebildschirm' : 'aus dem Portal'}
                      {r.contact && ` · Rückruf: ${r.contact}`}
                      {r.ticket && ` · ${r.ticket.key}`}
                    </p>
                    {r.note && <p className="text-sm text-gedimmt mt-1">{r.note}</p>}
                  </div>
                  {r.status === 'open' ? (
                    <button onClick={() => closePwHelp(r.id)}
                      className="px-3 py-1.5 border border-[#d8d4cd] text-gedimmt hover:bg-flaeche rounded text-sm transition-colors whitespace-nowrap">
                      Erledigt
                    </button>
                  ) : (
                    <span className="text-xs text-leise whitespace-nowrap">
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
            <button onClick={loadAudit} className="mb-4 px-4 py-2 bg-akzent hover:bg-akzent-hell text-white rounded transition-colors">
              <><RefreshCw size={14} className={audit.loading ? 'animate-spin' : ''} /> Aktualisieren</>
            </button>
            <div className="bg-white border border-linie rounded overflow-hidden">
              {audit.error && <p className="p-4 text-sm text-[#a32020]">{audit.error}</p>}
              {audit.entries.length === 0 && !audit.error && <p className="p-4 text-sm text-leise">Noch keine Einträge.</p>}
              {audit.entries.map((e, i) => (
                <div key={i} className="px-4 py-2 border-b border-linie last:border-0 text-sm flex gap-3">
                  <span className="text-leise font-mono text-xs whitespace-nowrap">{new Date(e.ts).toLocaleString('de-DE')}</span>
                  <span className="font-mono text-xs font-bold text-gedimmt whitespace-nowrap">{e.event}</span>
                  <span className="text-leise truncate">
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
