import React, { useState, useEffect } from 'react';
import { RefreshCw, ShieldCheck, ShieldAlert, Search } from 'lucide-react';
import { authedFetch } from '../auth';

// Das Audit-Log. Einmal gebaut, zweimal benutzt: im IT-Bereich und in der
// Administration. Vorher stand die Liste als Abschrift im IT-Bereich — zwei
// Fassungen desselben Dings laufen auseinander.
//
// Die Kettenprüfung sieht nur ein Administrator; sie ist eine Aussage über das
// Log selbst, nicht über einen Vorgang darin.
export default function AuditPanel({ mitKette = false }) {
  const [audit, setAudit] = useState({ entries: [], loading: true, error: null });
  const [kette, setKette] = useState(null);
  const [filter, setFilter] = useState('');
  const [limit, setLimit] = useState(200);

  const load = async () => {
    setAudit((a) => ({ ...a, loading: true }));
    try {
      const res = await authedFetch(`/api/audit?limit=${limit}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setAudit({ entries: data.entries || [], loading: false, error: null });
    } catch (err) {
      setAudit({ entries: [], loading: false, error: err.message });
    }
    if (mitKette) {
      try {
        const res = await authedFetch('/api/audit/verify');
        setKette(res.ok ? await res.json() : null);
      } catch {
        setKette(null);
      }
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [limit]);

  const suche = filter.trim().toLowerCase();
  const sichtbar = suche
    ? audit.entries.filter((e) => JSON.stringify(e).toLowerCase().includes(suche))
    : audit.entries;

  /** Alles außer Zeitstempel, Ereignis und Kettenhash — das steht schon vorne. */
  const rest = (e) => {
    const { ts, event, hash, prev, ...uebrig } = e;
    const text = Object.entries(uebrig)
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(' · ');
    return text;
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button onClick={load}
          className="px-4 py-2 bg-akzent hover:bg-akzent-hell text-white rounded text-sm transition-colors flex items-center gap-2">
          <RefreshCw size={14} className={audit.loading ? 'animate-spin' : ''} /> Aktualisieren
        </button>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-leise" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)}
            placeholder="filtern (Ereignis, Kennung, Gerät…)"
            className="pl-8 pr-3 py-2 w-64 bg-white border border-linie rounded text-sm focus:outline-none focus:ring-2 focus:ring-akzent/50" />
        </div>
        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}
          className="px-2 py-2 bg-white border border-linie rounded text-sm">
          {[200, 500, 1000].map((n) => <option key={n} value={n}>letzte {n}</option>)}
        </select>
        <span className="text-xs text-leise">
          {sichtbar.length} von {audit.entries.length} angezeigt
        </span>
      </div>

      {kette && (
        <div className={`mb-3 px-4 py-3 rounded border text-sm flex items-start gap-2 ${kette.ok
          ? 'bg-[#e9f5ec] border-[#b7dcc1] text-[#1f6b39]'
          : 'bg-[#fbeaea] border-[#e8bcbc] text-[#a32020]'}`}>
          {kette.ok ? <ShieldCheck size={16} className="mt-0.5 shrink-0" /> : <ShieldAlert size={16} className="mt-0.5 shrink-0" />}
          <span>
            {kette.ok
              ? `Kette unversehrt — ${kette.entries} Einträge, jeder trägt den Hash seines Vorgängers.`
              : `Kette gebrochen: ${kette.problems.map((p) => `Zeile ${p.line} (${p.reason})`).join(', ')}`}
          </span>
        </div>
      )}

      <div className="bg-white border border-linie rounded overflow-hidden">
        {audit.error && <p className="p-4 text-sm text-[#a32020]">{audit.error}</p>}
        {!audit.error && !sichtbar.length && !audit.loading && (
          <p className="p-4 text-sm text-leise">
            {audit.entries.length ? 'Kein Eintrag passt zum Filter.' : 'Noch keine Einträge.'}
          </p>
        )}
        {sichtbar.map((e, i) => (
          <div key={i} className="px-4 py-2 border-b border-linie last:border-0 text-sm flex gap-3">
            <span className="text-leise font-mono text-xs whitespace-nowrap">
              {new Date(e.ts).toLocaleString('de-DE')}
            </span>
            <span className="font-mono text-xs font-bold text-gedimmt whitespace-nowrap w-48 truncate" title={e.event}>
              {e.event}
            </span>
            <span className="text-leise text-xs truncate" title={rest(e)}>{rest(e)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
