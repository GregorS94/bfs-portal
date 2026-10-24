import React, { useState, useEffect } from 'react';
import { LogOut, Users, Wrench, Settings, KeyRound } from 'lucide-react';
import { initAuth, authedFetch, signIn, signOut, account, mode as authMode, simpleSignIn, localSignIn } from './auth';
import PasswordDialog from './views/PasswordDialog';
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
  { path: '/admin', name: 'Administration', icon: Settings, min: 'admin', component: AdminArea, subtitle: 'Dienste, Anbindungen, Konten, Logs' }
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
  const [passwortOffen, setPasswortOffen] = useState(false);

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

  const onLocalSignIn = async (username, password) => {
    const signedIn = await localSignIn(username, password);
    setUser(signedIn);
    setAuthenticated(true);
    // Kein Zwangsdialog: die Startpasswoerter sind fest. Wer sein Passwort
    // aendern will, findet den Knopf in der Seitenspalte.
  };

  if (!authenticated) {
    return (
      <LoginScreen
        mode={authMode()}
        ready={authReady && needsSignIn}
        onSimpleSignIn={onSimpleSignIn}
        onLocalSignIn={onLocalSignIn}
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
      {/* Seitenspalte 220px, Marine — die einzige dunkle Fläche der Oberfläche. */}
      <div className="w-[220px] flex-shrink-0 bg-schiene text-white flex flex-col">
        <div className="p-4 border-b border-white/10">
          <Wortmarke klein hell className="mb-4" />
          <p className="text-xs text-white/70 truncate">{user?.displayName}</p>
          <span className={`inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider ${
            // Die Rolle steht für Berechtigung, nicht für einen Zustand — darum
            // Petrol und Abstufungen davon, nie Bernstein oder Rot.
            user?.role === 'admin' ? 'bg-akzent text-white'
              : user?.role === 'it' ? 'bg-akzent/25 text-white'
              : 'bg-white/10 text-white/70'
          }`}>
            {ROLE_LABEL[user?.role] || user?.role}
          </span>
          {user?.authMode === 'local' && (
            // Sagt, wogegen geprueft wurde: gegen die Konten des Portals, nicht
            // gegen das Unternehmensverzeichnis.
            <p className="mt-2 text-[10px] leading-snug text-white/50">
              Lokales Konto (Prototyp)
            </p>
          )}
          {user?.authMode === 'simple' && (
            // Muss sichtbar bleiben: sonst sieht der einfache Weg im Betrieb
            // genauso aus wie eine geprüfte Anmeldung.
            <p className="mt-2 text-[10px] leading-snug text-warnung-rand">
              Testbetrieb — Identität ungeprüft
            </p>
          )}
        </div>

        <nav className="flex-1 p-2 space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-white/40 px-2 pb-1">Bereiche</p>
          {visibleAreas.map(a => {
            const Icon = a.icon;
            return (
              <button key={a.path} onClick={() => go(a.path)}
                className={`w-full text-left px-3 py-2 min-h-[44px] rounded-md flex items-center gap-2.5 transition-colors relative ${
                  area.path === a.path
                    ? 'bg-akzent text-white'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
                <Icon size={16} className="flex-shrink-0" />
                <span>
                  <span className="block text-sm font-medium">{a.name}</span>
                  {a.subtitle && <span className="block text-[11px] opacity-70">{a.subtitle}</span>}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="p-2 border-t border-white/10 space-y-1">
          {user?.authMode === 'local' && (
            <button onClick={() => setPasswortOffen(true)}
              className="w-full flex items-center gap-2 px-3 py-2 text-white/70 hover:bg-white/10 hover:text-white rounded-md text-sm transition-colors">
              <KeyRound size={16} /> Passwort ändern
            </button>
          )}
          <button onClick={() => (authMode() === 'off' ? setAuthenticated(false) : signOut())}
            className="w-full flex items-center gap-2 px-3 py-2 text-white/70 hover:bg-white/10 hover:text-white rounded-md text-sm transition-colors">
            <LogOut size={16} /> Abmelden
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="bg-white border-b border-linie px-6 h-[68px] flex flex-col justify-center">
          <h1 className="text-2xl font-semibold text-tinte leading-tight">{area.name}</h1>
          {area.subtitle && <p className="text-xs text-gedimmt">{area.subtitle}</p>}
        </div>

        {allowed ? <Body /> : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-lg font-semibold text-tinte mb-1">Kein Zugriff</p>
              <p className="text-sm text-gedimmt mb-4">
                Dieser Bereich ist der Rolle „{ROLE_LABEL[area.min]}" vorbehalten. Du bist „{ROLE_LABEL[user?.role]}".
              </p>
              <button onClick={() => go('/')} className="px-4 py-2 bg-akzent hover:bg-akzent-hell text-white rounded-md text-sm">
                Zum Mitarbeiter-Portal
              </button>
            </div>
          </div>
        )}
      </div>

      {passwortOffen && (
        <PasswordDialog
          onClose={() => setPasswortOffen(false)}
          onDone={() => setPasswortOffen(false)}
        />
      )}
    </div>
  );
}
