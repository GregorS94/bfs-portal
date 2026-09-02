import React, { useState, useEffect } from 'react';
import { LogOut, Users, Wrench, Settings } from 'lucide-react';
import { initAuth, authedFetch, signIn, signOut, account, mode as authMode, simpleSignIn } from './auth';
import UserPortal from './views/UserPortal';
import ITArea from './views/ITArea';
import AdminArea from './views/AdminArea';
import LoginScreen from './views/LoginScreen';
import Wortmarke from './Wortmarke';

// Drei getrennte Bereiche unter eigenen Adressen. Kein Router als Abhängigkeit —
// nginx liefert für jeden Pfad dieselbe index.html, den Rest macht history.pushState.
const AREAS = [
  { path: '/', name: 'Mitarbeiter', icon: Users, min: 'user', component: UserPortal, subtitle: null },
  { path: '/it', name: 'IT-Support', icon: Wrench, min: 'it', component: ITArea, subtitle: 'Aufträge und Geräte' },
  { path: '/admin', name: 'Administration', icon: Settings, min: 'admin', component: AdminArea, subtitle: 'Dienste und Konfiguration' }
];

const ROLES = ['user', 'it', 'admin'];
const rank = (role) => Math.max(0, ROLES.indexOf(role));
const ROLE_LABEL = { user: 'Mitarbeiter', it: 'IT-Support', admin: 'Administrator' };

export default function App() {
  const [user, setUser] = useState(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [path, setPath] = useState(window.location.pathname.replace(/\/+$/, '') || '/');

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname.replace(/\/+$/, '') || '/');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = (target) => {
    window.history.pushState({}, '', target);
    setPath(target);
  };

  useEffect(() => {
    const boot = async () => {
      try {
        const cfg = await initAuth();
        // 'off' meldet den Entwicklungs-Benutzer an, alle anderen Wege brauchen
        // erst eine Sitzung.
        if (authMode() !== 'off' && !account()) {
          setNeedsSignIn(true);
          setAuthReady(true);
          return;
        }
        const res = await authedFetch('/api/auth/login', { method: 'POST' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setUser(data.user);
        setAuthenticated(true);
      } catch (error) {
        console.error('Anmeldung fehlgeschlagen:', error);
        setNeedsSignIn(authMode() !== 'off');
      }
      setAuthReady(true);
    };
    boot();
  }, []);

  const onSimpleSignIn = async (identity) => {
    const signedIn = await simpleSignIn(identity);
    setUser(signedIn);
    setAuthenticated(true);
  };

  if (!authenticated) {
    return (
      <LoginScreen
        mode={authMode()}
        ready={authReady && needsSignIn}
        onSimpleSignIn={onSimpleSignIn}
        onEntraSignIn={signIn}
      />
    );
  }

  const area = AREAS.find(a => a.path === path) || AREAS[0];
  const allowed = rank(user?.role) >= rank(area.min);
  const visibleAreas = AREAS.filter(a => rank(user?.role) >= rank(a.min));
  const Body = area.component;

  return (
    <div className="flex h-screen bg-flaeche">
      <div className="w-64 bg-white border-r border-linie text-tinte flex flex-col">
        <div className="p-5 border-b border-linie">
          <Wortmarke klein className="mb-4" />
          <p className="text-xs text-gedimmt truncate">{user?.displayName}</p>
          <span className={`inline-block mt-2 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider ring-1 ${
            // Kein zweiter Farbton neben Orange — die Rolle unterscheidet sich
            // über die Sättigung, nicht über eine neue Farbe.
            user?.role === 'admin' ? 'bg-akzent text-white ring-akzent'
              : user?.role === 'it' ? 'bg-akzent-zart text-[#a04c00] ring-akzent-rand'
              : 'bg-flaeche text-gedimmt ring-linie'
          }`}>
            {ROLE_LABEL[user?.role] || user?.role}
          </span>
          {user?.authMode === 'simple' && (
            // Muss sichtbar bleiben: sonst sieht der einfache Weg im Betrieb
            // genauso aus wie eine geprüfte Anmeldung.
            <p className="mt-2 text-[10px] leading-snug text-[#8a5200]">
              Testbetrieb — Identität ungeprüft
            </p>
          )}
        </div>

        <nav className="flex-1 p-3 space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-leise px-2 pb-1">Bereiche</p>
          {visibleAreas.map(a => {
            const Icon = a.icon;
            return (
              <button key={a.path} onClick={() => go(a.path)}
                className={`w-full text-left px-3 py-2.5 min-h-[46px] rounded flex items-center gap-2.5 transition-all relative ${
                  area.path === a.path
                    ? 'bg-akzent-zart text-[#a04c00] ring-1 ring-akzent-rand'
                    : 'text-gedimmt hover:bg-flaeche hover:text-tinte'}`}>
                {area.path === a.path && <span className="absolute left-0 top-2.5 bottom-2.5 w-0.5 rounded-full bg-akzent" />}
                <Icon size={16} className="flex-shrink-0" />
                <span>
                  <span className="block text-sm font-medium">{a.name}</span>
                  {a.subtitle && <span className="block text-[11px] opacity-70">{a.subtitle}</span>}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-linie">
          <button onClick={() => (authMode() === 'off' ? setAuthenticated(false) : signOut())}
            className="w-full flex items-center gap-2 px-3 py-2 text-gedimmt hover:bg-flaeche hover:text-tinte rounded text-sm transition-colors">
            <LogOut size={16} /> Abmelden
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="bg-white/80 border-b border-linie px-6 h-[68px] flex flex-col justify-center backdrop-blur">
          <h1 className="font-semibold text-tinte">{area.name}</h1>
          {area.subtitle && <p className="text-xs text-leise">{area.subtitle}</p>}
        </div>

        {allowed ? <Body user={user} /> : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-lg font-bold text-tinte mb-1">Kein Zugriff</p>
              <p className="text-sm text-leise mb-4">
                Dieser Bereich ist der Rolle „{ROLE_LABEL[area.min]}" vorbehalten. Du bist „{ROLE_LABEL[user?.role]}".
              </p>
              <button onClick={() => go('/')} className="px-4 py-2 bg-akzent hover:bg-akzent-hell text-white rounded text-sm">
                Zum Mitarbeiter-Portal
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
