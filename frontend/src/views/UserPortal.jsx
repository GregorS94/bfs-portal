import React, { useState, useEffect, useRef } from 'react';
import { Send, CheckCircle, AlertCircle, ShieldAlert, Terminal, MessageSquare, Package, Loader2 } from 'lucide-react';
import RichText from '../markdown';
import { authedFetch } from '../auth';

// Mitarbeiter-Sicht: Chat und Software. Keine Geräte, kein Audit.
export default function UserPortal() {
  const [activeTab, setActiveTab] = useState('chat');
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [toolRuns, setToolRuns] = useState([]);
  const messagesEndRef = useRef(null);

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
        if (p.error) appendToLastMessage(`\n\nFehler: ${p.error}`);
      });
    } catch (error) {
      appendToLastMessage('Fehler beim Verbinden mit dem Support-Backend.');
    }
    setLoading(false);
  };

  const decideApproval = async (jobId, approve) => {
    setPendingApprovals(prev => prev.filter(a => a.jobId !== jobId));
    try {
      const res = await authedFetch(`/api/jobs/${jobId}/${approve ? 'approve' : 'deny'}`, { method: 'POST' });
      const job = await res.json();
      if (!approve) return addMessage('assistant', 'Aktion abgelehnt — ich führe nichts aus.');
      if (job.error && !job.status) return addMessage('assistant', `Fehler: ${job.error}`);

      const summary = await authedFetch('/api/support/job-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId })
      });
      const { text, error } = await summary.json();
      addMessage('assistant', text || `Aktion beendet (Status ${job.status}). ${error || ''}`);
    } catch {
      addMessage('assistant', 'Die Aktion konnte nicht abgeschlossen werden.');
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
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'software', label: 'Software', icon: Package }
  ];

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
        {activeTab === 'chat' && (
          <div className="flex flex-col h-full">
            <div className="flex-1 space-y-4 mb-4">
              {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center px-6">
                  <MessageSquare size={26} className="text-akzent mb-4" strokeWidth={1.5} />
                  <h2 className="font-kopf text-xl font-bold text-tinte mb-1">Wobei kann der Support helfen?</h2>
                  <p className="text-sm text-leise mb-6 max-w-md">
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
                        className="px-3 py-1.5 text-sm text-gedimmt bg-white border border-linie hover:border-[#c9c3ba] hover:text-tinte rounded transition-colors">
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
                      ? 'bg-akzent text-white rounded-md rounded-br-md shadow-lg shadow-black/5'
                      : 'bg-white border border-linie text-tinte rounded-md rounded-bl-md'}`}>
                    <RichText text={msg.content} />
                  </div>
                </div>
              ))}

              {toolRuns.map((t, i) => (
                <div key={i} className="flex justify-start">
                  <div className="flex items-center gap-2 text-xs text-leise bg-flaeche border border-linie rounded px-3 py-2">
                    <Terminal size={14} />
                    <span className="font-mono">{t.action}</span>
                    <span>{t.state === 'running' ? '… läuft' : t.state === 'ok' ? '✓ abgerufen' : '✗ fehlgeschlagen'}</span>
                  </div>
                </div>
              ))}

              {pendingApprovals.map(a => (
                <div key={a.jobId} className="flex justify-start">
                  <div className="max-w-2xl bg-[#fdf3e2] border border-[#e9c98f] rounded-md p-4 rise-in">
                    <div className="flex items-center gap-2 font-bold text-[#8a5200] mb-2">
                      <ShieldAlert size={18} /> Freigabe erforderlich
                    </div>
                    <p className="text-sm text-[#8a5200] mb-1">
                      Aktion <span className="font-mono font-bold">{a.action}</span> auf <span className="font-bold">{a.device}</span>
                    </p>
                    {Object.keys(a.params || {}).length > 0 && (
                      <pre className="text-xs bg-white border border-[#e9c98f] rounded p-2 mb-3 overflow-x-auto">
                        {JSON.stringify(a.params, null, 2)}
                      </pre>
                    )}
                    <div className="flex gap-2">
                      <button onClick={() => decideApproval(a.jobId, true)} className="px-3.5 py-1.5 bg-akzent hover:bg-akzent-hell text-white rounded text-sm font-medium transition-colors">Ausführen</button>
                      <button onClick={() => decideApproval(a.jobId, false)} className="px-3.5 py-1.5 text-gedimmt hover:bg-flaeche border border-[#d8d4cd] rounded text-sm transition-colors">Ablehnen</button>
                    </div>
                  </div>
                </div>
              ))}

              {loading && messages[messages.length - 1]?.content === '' && (
                <div className="text-leise text-sm flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Support prüft…</div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="flex gap-2">
              <input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleChatSubmit()} disabled={loading}
                placeholder="Problem beschreiben…"
                className="flex-1 px-4 py-3 border border-[#d8d4cd] rounded focus:outline-none focus:ring-2 focus:ring-akzent" />
              <button onClick={handleChatSubmit} disabled={loading}
                className="px-4 py-3 bg-akzent hover:bg-akzent-hell disabled:bg-[#ddd8d1] disabled:text-leise text-white rounded">
                <Send size={20} />
              </button>
            </div>
          </div>
        )}

        {activeTab === 'software' && (
          <div>
            <button onClick={loadSoftware} className="mb-4 px-4 py-2 bg-akzent hover:bg-akzent-hell text-white rounded transition-colors">
              {softwareData.loading ? 'Wird geladen…' : 'Software laden'}
            </button>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {softwareData.available.map(app => (
                <div key={app.id} className="bg-white p-4 rounded border border-linie hover:border-[#d8d4cd] transition-colors">
                  <h3 className="font-bold text-tinte">{app.name}</h3>
                  <p className="text-sm text-leise">{app.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
