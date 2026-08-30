import React, { useState, useEffect, useRef } from 'react';
import { Send, CheckCircle, AlertCircle, ShieldAlert, Terminal } from 'lucide-react';
import RichText from '../markdown';
import { authedFetch } from '../auth';

// Mitarbeiter-Sicht: Chat, Passwort, Software. Keine Geräte, kein Audit.
export default function UserPortal() {
  const [activeTab, setActiveTab] = useState('chat');
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [toolRuns, setToolRuns] = useState([]);
  const messagesEndRef = useRef(null);

  const [passwordData, setPasswordData] = useState({
    contact: '', note: '', loading: false, message: null, success: false
  });
  const [softwareData, setSoftwareData] = useState({ available: [], loading: false });

  const addMessage = (role, content) =>
    setMessages(prev => [...prev, { id: prev.length + 1, role, content, timestamp: new Date() }]);

  const appendToLastMessage = (chunk) =>
    setMessages(prev => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      copy[copy.length - 1] = { ...last, content: last.content + chunk };
      return copy;
    });

  // Liest einen SSE-Strom und reicht jede Nutzlast an den Handler weiter.
  const consumeStream = async (res, onPayload) => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        if (raw.startsWith('data: ')) onPayload(JSON.parse(raw.slice(6)));
      }
    }
  };

  const handleChatSubmit = async () => {
    if (!inputValue.trim() || loading) return;
    const question = inputValue;
    const history = messages.filter(m => m.content).map(m => ({ role: m.role, content: m.content }));

    setInputValue('');
    setMessages(prev => [
      ...prev,
      { id: prev.length + 1, role: 'user', content: question, timestamp: new Date() },
      { id: prev.length + 2, role: 'assistant', content: '', timestamp: new Date() }
    ]);
    setLoading(true);
    setToolRuns([]);

    try {
      const res = await authedFetch('/api/support/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question, history })
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      await consumeStream(res, (p) => {
        if (p.text) appendToLastMessage(p.text);
        if (p.tool_start) setToolRuns(prev => [...prev, { ...p.tool_start, state: 'running' }]);
        if (p.tool_result) {
          setToolRuns(prev => prev.map(t =>
            t.action === p.tool_result.action && t.state === 'running'
              ? { ...t, state: p.tool_result.ok ? 'ok' : 'error' } : t));
        }
        if (p.approval_request) setPendingApprovals(prev => [...prev, p.approval_request]);
        if (p.error) appendToLastMessage(`\n\n❌ ${p.error}`);
      });
    } catch (error) {
      appendToLastMessage('❌ Fehler beim Verbinden mit dem Support-Backend.');
    }
    setLoading(false);
  };

  const decideApproval = async (jobId, approve) => {
    setPendingApprovals(prev => prev.filter(a => a.jobId !== jobId));
    try {
      const res = await authedFetch(`/api/jobs/${jobId}/${approve ? 'approve' : 'deny'}`, { method: 'POST' });
      const job = await res.json();
      if (!approve) return addMessage('assistant', '🚫 Aktion abgelehnt — ich führe nichts aus.');
      if (job.error && !job.status) return addMessage('assistant', `❌ ${job.error}`);

      const summary = await authedFetch('/api/support/job-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId })
      });
      const { text, error } = await summary.json();
      addMessage('assistant', text || `Aktion beendet (Status ${job.status}). ${error || ''}`);
    } catch {
      addMessage('assistant', '❌ Die Aktion konnte nicht abgeschlossen werden.');
    }
  };

  // Kein Zuruecksetzen aus dem Portal heraus. Das Portal legt eine Anfrage an,
  // die IT prueft die Identitaet ausserhalb und loest danach reset_ad_password
  // aus — freigegeben von einer zweiten Person.
  const requestPasswordHelp = async () => {
    setPasswordData({ ...passwordData, loading: true, message: null });
    try {
      const res = await authedFetch('/api/self-service/password-help', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact: passwordData.contact, note: passwordData.note })
      });
      const data = await res.json();
      // Ohne diese Pruefung meldete die Oberflaeche auch dann Erfolg, wenn das
      // Backend gar nichts angelegt hat.
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPasswordData({ contact: '', note: '', loading: false, message: data.message, success: true });
    } catch (err) {
      setPasswordData({ ...passwordData, loading: false, message: `Fehlgeschlagen: ${err.message}`, success: false });
    }
  };

  const loadSoftware = async () => {
    setSoftwareData({ ...softwareData, loading: true });
    const res = await authedFetch('/api/baramundi/software');
    const data = await res.json();
    setSoftwareData({ available: data.available || [], loading: false });
  };

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, pendingApprovals]);

  const TABS = [
    { id: 'chat', label: '💬 Chat' },
    { id: 'password', label: '🔐 Passwort-Hilfe' },
    { id: 'software', label: '💻 Software' }
  ];

  return (
    <>
      <div className="border-b border-slate-800 px-6 py-3 flex gap-1">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-3.5 py-1.5 rounded-lg text-sm transition-colors ${
              activeTab === t.id
                ? 'bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-500/25'
                : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'chat' && (
          <div className="flex flex-col h-full">
            <div className="flex-1 space-y-4 mb-4">
              {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center px-6">
                  <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 ring-1 ring-indigo-500/20 flex items-center justify-center text-2xl mb-4">🐝</div>
                  <h2 className="text-lg font-semibold text-slate-200 mb-1">Womit kann ich helfen?</h2>
                  <p className="text-sm text-slate-500 mb-6 max-w-md">
                    Beschreib dein Problem in eigenen Worten. Ich sehe bei Bedarf selbst auf deinem Gerät nach —
                    Änderungen führe ich erst nach deiner Freigabe aus.
                  </p>
                  <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                    {[
                      'Mein Drucker druckt nicht',
                      'Wie voll ist meine Festplatte?',
                      'Outlook startet nicht mehr',
                      'VPN verbindet sich nicht'
                    ].map(v => (
                      <button key={v} onClick={() => setInputValue(v)}
                        className="px-3 py-1.5 text-sm text-slate-300 bg-[#131a27] border border-slate-800 hover:border-slate-600 hover:text-slate-100 rounded-xl transition-colors">
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map(msg => (
                <div key={msg.id} className={`flex rise-in ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-2xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-2xl rounded-br-md shadow-lg shadow-indigo-600/15'
                      : 'bg-[#131a27] border border-slate-800 text-slate-200 rounded-2xl rounded-bl-md'}`}>
                    <RichText text={msg.content} />
                  </div>
                </div>
              ))}

              {toolRuns.map((t, i) => (
                <div key={i} className="flex justify-start">
                  <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-800/40 border border-slate-800 rounded-lg px-3 py-2">
                    <Terminal size={14} />
                    <span className="font-mono">{t.action}</span>
                    <span>{t.state === 'running' ? '… läuft' : t.state === 'ok' ? '✓ abgerufen' : '✗ fehlgeschlagen'}</span>
                  </div>
                </div>
              ))}

              {pendingApprovals.map(a => (
                <div key={a.jobId} className="flex justify-start">
                  <div className="max-w-2xl bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 rise-in">
                    <div className="flex items-center gap-2 font-bold text-amber-200 mb-2">
                      <ShieldAlert size={18} /> Freigabe erforderlich
                    </div>
                    <p className="text-sm text-amber-200 mb-1">
                      Aktion <span className="font-mono font-bold">{a.action}</span> auf <span className="font-bold">{a.device}</span>
                    </p>
                    {Object.keys(a.params || {}).length > 0 && (
                      <pre className="text-xs bg-[#131a27] border border-amber-500/30 rounded p-2 mb-3 overflow-x-auto">
                        {JSON.stringify(a.params, null, 2)}
                      </pre>
                    )}
                    <div className="flex gap-2">
                      <button onClick={() => decideApproval(a.jobId, true)} className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-sm font-medium transition-colors">Ausführen</button>
                      <button onClick={() => decideApproval(a.jobId, false)} className="px-3.5 py-1.5 text-slate-300 hover:bg-slate-800 border border-slate-700 rounded-xl text-sm transition-colors">Ablehnen</button>
                    </div>
                  </div>
                </div>
              ))}

              {loading && messages[messages.length - 1]?.content === '' && (
                <div className="text-slate-500 text-sm">⏳ Support denkt nach…</div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="flex gap-2">
              <input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleChatSubmit()} disabled={loading}
                placeholder="Womit kann ich helfen?"
                className="flex-1 px-4 py-3 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <button onClick={handleChatSubmit} disabled={loading}
                className="px-4 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg">
                <Send size={20} />
              </button>
            </div>
          </div>
        )}

        {activeTab === 'password' && (
          <div className="max-w-md space-y-4">
            <p className="text-sm text-slate-400">
              Passwort vergessen oder Konto gesperrt? Fordere Hilfe an. Der IT-Support prüft
              deine Identität ausserhalb des Portals und setzt erst danach zurück — die
              Freigabe erteilt eine zweite Person aus der IT.
            </p>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Rückruf (optional)</label>
              <input value={passwordData.contact}
                onChange={(e) => setPasswordData({ ...passwordData, contact: e.target.value })}
                placeholder="Durchwahl oder Mobilnummer"
                className="w-full px-4 py-2.5 bg-[#131a27] border border-slate-800 text-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/60" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Anmerkung (optional)</label>
              <textarea value={passwordData.note} rows={3}
                onChange={(e) => setPasswordData({ ...passwordData, note: e.target.value })}
                placeholder="z. B. Konto gesperrt seit heute früh"
                className="w-full px-4 py-2.5 bg-[#131a27] border border-slate-800 text-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/60" />
            </div>
            {passwordData.message && (
              <div className={`p-3 rounded-lg flex items-start gap-2 text-sm ${passwordData.success ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/10 text-rose-300 border border-rose-500/30'}`}>
                {passwordData.success ? <CheckCircle size={18} className="shrink-0 mt-0.5" /> : <AlertCircle size={18} className="shrink-0 mt-0.5" />}
                {passwordData.message}
              </div>
            )}
            <button onClick={requestPasswordHelp} disabled={passwordData.loading}
              className="w-full px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white rounded-xl transition-colors font-medium">
              {passwordData.loading ? '⏳' : 'Hilfe anfordern'}
            </button>
          </div>
        )}

        {activeTab === 'software' && (
          <div>
            <button onClick={loadSoftware} className="mb-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-colors">
              {softwareData.loading ? '⏳' : '📦 Software laden'}
            </button>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {softwareData.available.map(app => (
                <div key={app.id} className="bg-[#131a27] p-4 rounded-xl border border-slate-800 hover:border-slate-700 transition-colors">
                  <h3 className="font-bold text-slate-100">{app.name}</h3>
                  <p className="text-sm text-slate-500">{app.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
