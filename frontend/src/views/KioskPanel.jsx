import React, { useState, useEffect } from 'react';
import { Package, ExternalLink, Clock, CheckCircle, XCircle, RefreshCw, Info } from 'lucide-react';
import { authedFetch } from '../auth';

// Software anfordern. Das Portal installiert nichts — es erteilt die Freigabe,
// und abgeholt wird im baramundi Kiosk. Warum das so getrennt ist, steht in
// docs/BARAMUNDI.md: Freigabe und Ausführung liegen damit in verschiedenen
// Händen, ohne dass wir dafür ein Vier-Augen-Verfahren bauen müssten.
const ZUSTAND = {
  requested: { label: 'wartet auf Freigabe', icon: Clock, klasse: 'bg-[#fdf3e2] text-[#8a5200] ring-[#e9c98f]' },
  released: { label: 'freigegeben', icon: CheckCircle, klasse: 'bg-[#e9f5ec] text-[#1f6b39] ring-[#b7dcc1]' },
  denied: { label: 'abgelehnt', icon: XCircle, klasse: 'bg-[#fbeaea] text-[#a32020] ring-[#e8bcbc]' },
  withdrawn: { label: 'zurückgezogen', icon: XCircle, klasse: 'bg-flaeche text-gedimmt ring-linie' }
};

export default function KioskPanel() {
  const [state, setState] = useState({ ready: false, jobs: [], requests: [], kioskUrl: '', problem: null, loading: true, error: null });
  const [meldung, setMeldung] = useState(null);

  const load = async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const res = await authedFetch('/api/kiosk/catalog');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setState({ ...data, loading: false, error: null });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
    }
  };

  useEffect(() => { load(); }, []);

  const anfordern = async (job) => {
    setMeldung(null);
    try {
      const res = await authedFetch('/api/kiosk/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobDefinitionId: job.id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMeldung({ ok: true, text: `„${job.name}" ist angefordert. Die IT gibt sie frei, danach holst du sie im Kiosk ab.` });
      await load();
    } catch (err) {
      setMeldung({ ok: false, text: err.message });
    }
  };

  /** Zu welchen Jobs läuft schon etwas? Dann kein zweiter Knopf. */
  const offen = new Set(state.requests.filter((r) => ['requested', 'released'].includes(r.state)).map((r) => r.jobDefinitionId));

  return (
    <div>
      {state.error && (
        <div className="mb-4 p-3 rounded border bg-[#fbeaea] border-[#e8bcbc] text-[#a32020] text-sm">{state.error}</div>
      )}

      {!state.ready && !state.loading && !state.error && (
        <div className="mb-4 p-4 rounded border bg-white border-linie text-sm text-gedimmt flex gap-3">
          <Info size={18} className="shrink-0 mt-0.5 text-leise" />
          <div>
            <p className="font-medium text-tinte mb-1">Der Kiosk ist nicht eingerichtet.</p>
            <p className="text-leise">
              Es fehlt die Verbindung zu baramundi bConnect oder die Liste der freigebbaren Jobs
              (<span className="font-mono text-xs">BCONNECT_KIOSK_JOBS</span>). Solange nichts eingetragen ist,
              gibt es hier nichts anzufordern — das ist Absicht und keine Störung.
            </p>
          </div>
        </div>
      )}

      {state.problem && (
        <div className="mb-4 p-3 rounded border bg-[#fdf3e2] border-[#e9c98f] text-[#8a5200] text-sm">
          Der Katalog konnte nicht geladen werden: {state.problem}
        </div>
      )}

      {meldung && (
        <div className={`mb-4 p-3 rounded border text-sm ${meldung.ok
          ? 'bg-[#e9f5ec] border-[#b7dcc1] text-[#1f6b39]'
          : 'bg-[#fbeaea] border-[#e8bcbc] text-[#a32020]'}`}>
          {meldung.text}
        </div>
      )}

      {state.requests.length > 0 && (
        <>
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-leise">Deine Anforderungen</h2>
            <button onClick={load} className="text-leise hover:text-tinte" title="Aktualisieren">
              <RefreshCw size={13} className={state.loading ? 'animate-spin' : ''} />
            </button>
          </div>
          <div className="mb-6 bg-white border border-linie rounded overflow-hidden">
            {state.requests.map((r) => {
              const z = ZUSTAND[r.state] || ZUSTAND.requested;
              const Symbol = z.icon;
              return (
                <div key={r.id} className="px-4 py-3 border-b border-linie last:border-0 flex items-center gap-3 flex-wrap">
                  <span className="font-medium text-tinte w-56 truncate">{r.jobName}</span>
                  <span className={`text-[10px] uppercase font-bold tracking-wide ring-1 rounded px-1.5 py-0.5 flex items-center gap-1 ${z.klasse}`}>
                    <Symbol size={11} /> {z.label}
                  </span>
                  <span className="text-xs text-leise ml-auto">
                    {new Date(r.requestedAt).toLocaleDateString('de-DE')}
                  </span>
                  {r.state === 'released' && state.kioskUrl && (
                    <a href={state.kioskUrl} target="_blank" rel="noopener noreferrer"
                      className="px-3 py-1.5 bg-akzent hover:bg-akzent-hell text-white rounded text-xs font-medium transition-colors flex items-center gap-1.5">
                      Im Kiosk abholen <ExternalLink size={12} />
                    </a>
                  )}
                  {r.state === 'denied' && r.note && (
                    <span className="text-xs text-leise w-full">Begründung: {r.note}</span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {state.jobs.length > 0 && (
        <>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-leise mb-2">Verfügbar</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {state.jobs.map((job) => (
              <div key={job.id} className="bg-white p-4 rounded border border-linie hover:border-[#d8d4cd] transition-colors flex flex-col">
                <div className="flex items-start gap-2 mb-1">
                  <Package size={16} className="text-akzent shrink-0 mt-0.5" />
                  <h3 className="font-bold text-tinte">{job.name}</h3>
                </div>
                <p className="text-sm text-leise flex-1 mb-3">{job.comment || 'Keine Beschreibung hinterlegt.'}</p>
                <button onClick={() => anfordern(job)} disabled={offen.has(job.id)}
                  className="self-start px-3.5 py-1.5 bg-akzent hover:bg-akzent-hell disabled:bg-[#ddd8d1] disabled:text-leise text-white rounded text-sm font-medium transition-colors">
                  {offen.has(job.id) ? 'läuft schon' : 'Anfordern'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {state.ready && state.kioskUrl && (
        <p className="mt-6 text-xs text-leise">
          Der Kiosk selbst liegt unter{' '}
          <a href={state.kioskUrl} target="_blank" rel="noopener noreferrer" className="underline">{state.kioskUrl}</a>
          {' '}— dort wird installiert, hier nur angefordert.
        </p>
      )}
    </div>
  );
}
