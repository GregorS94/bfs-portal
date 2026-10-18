import React, { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle, XCircle, Undo2 } from 'lucide-react';
import { authedFetch } from '../auth';

// Software-Anforderungen freigeben. Das Zuweisungsziel trägt die IT ein: die
// Kennung des AD-Objekts oder Geräts, für das die Freigabe gelten soll. Das
// Portal kann sie nicht aus dem Anmeldenamen ableiten — dafür wären die
// AD-Leseendpunkte von bConnect nötig, deren Pfade uns nicht wörtlich
// vorliegen. Geraten wird hier nichts; siehe docs/BARAMUNDI.md.
const ZUSTAND_LABEL = {
  requested: 'offen', released: 'freigegeben', denied: 'abgelehnt', withdrawn: 'zurückgezogen'
};

export default function KioskApprovals() {
  const [state, setState] = useState({ requests: [], loading: true, error: null });
  const [ziel, setZiel] = useState({});
  const [meldung, setMeldung] = useState(null);

  const load = async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const res = await authedFetch('/api/kiosk/requests');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setState({ requests: data.requests || [], loading: false, error: null });
    } catch (err) {
      setState({ requests: [], loading: false, error: err.message });
    }
  };

  useEffect(() => { load(); }, []);

  const entscheide = async (r, weg, koerper, text) => {
    setMeldung(null);
    try {
      const res = await authedFetch(`/api/kiosk/requests/${r.id}/${weg}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(koerper || {})
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMeldung({ ok: true, text });
      await load();
    } catch (err) {
      setMeldung({ ok: false, text: err.message });
    }
  };

  const offen = state.requests.filter((r) => r.state === 'requested');
  const rest = state.requests.filter((r) => r.state !== 'requested');

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <button onClick={load}
          className="px-4 py-2 bg-akzent hover:bg-akzent-hell text-white rounded text-sm transition-colors flex items-center gap-2">
          <RefreshCw size={14} className={state.loading ? 'animate-spin' : ''} /> Aktualisieren
        </button>
        <span className="text-sm text-leise">{offen.length} offen</span>
      </div>

      {meldung && (
        <div className={`mb-3 p-3 rounded border text-sm ${meldung.ok
          ? 'bg-[#e9f5ec] border-[#b7dcc1] text-[#1f6b39]'
          : 'bg-[#fbeaea] border-[#e8bcbc] text-[#a32020]'}`}>
          {meldung.text}
        </div>
      )}
      {state.error && (
        <div className="mb-3 p-3 rounded border bg-[#fbeaea] border-[#e8bcbc] text-[#a32020] text-sm">{state.error}</div>
      )}

      {offen.map((r) => (
        <div key={r.id} className="mb-3 p-4 bg-white border border-[#e9c98f] rounded">
          <p className="text-sm text-tinte mb-1">
            <strong>{r.username}</strong> möchte <strong>{r.jobName}</strong>
          </p>
          {r.note && <p className="text-xs text-leise mb-2">„{r.note}"</p>}
          <p className="text-xs text-leise mb-3">
            angefordert {new Date(r.requestedAt).toLocaleString('de-DE')} · Jobdefinition{' '}
            <span className="font-mono">{r.jobDefinitionId}</span>
          </p>
          <div className="flex gap-2 items-center flex-wrap">
            <input value={ziel[r.id] || ''} onChange={(e) => setZiel({ ...ziel, [r.id]: e.target.value })}
              placeholder="Zuweisungsziel (AD-Objekt oder Gerät)"
              className="px-3 py-2 w-72 bg-white border border-linie rounded text-sm focus:outline-none focus:ring-2 focus:ring-akzent/50" />
            <button onClick={() => entscheide(r, 'release', { assignmentTargetId: (ziel[r.id] || '').trim() },
              `„${r.jobName}" für ${r.username} freigegeben.`)}
              disabled={!(ziel[r.id] || '').trim()}
              className="px-3.5 py-2 bg-akzent hover:bg-akzent-hell disabled:bg-[#ddd8d1] disabled:text-leise text-white rounded text-sm font-medium transition-colors flex items-center gap-1.5">
              <CheckCircle size={15} /> Freigeben
            </button>
            <button onClick={() => {
              const grund = window.prompt('Begründung (erscheint beim Anfordernden):') || '';
              entscheide(r, 'deny', { note: grund }, `„${r.jobName}" für ${r.username} abgelehnt.`);
            }}
              className="px-3.5 py-2 text-gedimmt hover:bg-flaeche border border-[#d8d4cd] rounded text-sm transition-colors flex items-center gap-1.5">
              <XCircle size={15} /> Ablehnen
            </button>
          </div>
        </div>
      ))}

      {!offen.length && !state.loading && (
        <p className="mb-6 text-sm text-leise">Keine offene Anforderung.</p>
      )}

      {rest.length > 0 && (
        <>
          <h2 className="mt-6 mb-2 text-sm font-semibold uppercase tracking-wide text-leise">Verlauf</h2>
          <div className="bg-white border border-linie rounded overflow-hidden">
            {rest.map((r) => (
              <div key={r.id} className="px-4 py-3 border-b border-linie last:border-0 flex items-center gap-3 flex-wrap text-sm">
                <span className="text-leise font-mono text-xs w-36 truncate">{r.username}</span>
                <span className="font-medium text-tinte w-48 truncate">{r.jobName}</span>
                <span className="text-xs text-leise w-28">{ZUSTAND_LABEL[r.state]}</span>
                <span className="text-xs text-leise truncate">
                  {r.decidedBy ? `von ${r.decidedBy}` : ''}
                  {r.releaseId ? ` · Freigabe ${r.releaseId}` : ''}
                  {r.assignmentTargetId ? ` · Ziel ${r.assignmentTargetId}` : ''}
                </span>
                {r.state === 'released' && (
                  <button onClick={() => entscheide(r, 'withdraw', {}, `Freigabe für „${r.jobName}" zurückgezogen.`)}
                    className="ml-auto px-3 py-1.5 text-gedimmt hover:bg-flaeche border border-[#d8d4cd] rounded text-xs transition-colors flex items-center gap-1.5">
                    <Undo2 size={13} /> Zurückziehen
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
