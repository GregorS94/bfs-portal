// Basisadresse des Portals.
//
// Im Browser leer: die Oberfläche wird vom selben nginx ausgeliefert wie die
// API, relative Pfade treffen also von selbst das Richtige. Im Desktop-
// Programm ist der Ursprung `tauri://localhost` — dort muss die Adresse des
// Portals beim Bauen mitgegeben werden (VITE_API_BASE).
export const API_BASE = (import.meta.env?.VITE_API_BASE || '').replace(/\/$/, '');

/** Setzt die Basisadresse vor einen API-Pfad. Ohne Basis bleibt alles wie bisher. */
export function apiUrl(pfad) {
  return pfad.startsWith('/') ? API_BASE + pfad : pfad;
}

// Anmeldung gegen Entra ID (Microsoft 365).
//
// Die Konfiguration kommt zur Laufzeit vom Backend (/api/config), nicht aus dem
// Build. Dadurch reicht ein Eintrag in der .env und ein Neustart — das Image
// muss nicht neu gebaut werden, wenn Mandant oder Client-ID wechseln.

import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser';

let msal = null;
let config = { authEnabled: false, mode: 'off' };

// Sitzung des einfachen Anmeldewegs. sessionStorage statt localStorage: mit dem
// Schliessen des Fensters ist man abgemeldet.
const SIMPLE_KEY = 'bfs.simple.token';
const simpleToken = () => sessionStorage.getItem(SIMPLE_KEY) || '';

// Sitzung der lokalen Konten. Auch hier sessionStorage: mit dem Schliessen des
// Fensters ist man abgemeldet. localStorage waere bequemer und auf einem
// geteilten Rechner falsch.
const LOCAL_KEY = 'bfs.local.token';
const localToken = () => sessionStorage.getItem(LOCAL_KEY) || '';

export function mode() {
  return config.mode || (config.authEnabled ? 'entra' : 'off');
}

export function authConfig() {
  return config;
}

export async function initAuth() {
  const res = await fetch(apiUrl('/api/config'));
  config = await res.json();

  if (!config.authEnabled) return config;

  msal = new PublicClientApplication({
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
      redirectUri: window.location.origin
    },
    cache: { cacheLocation: 'sessionStorage' }
  });

  await msal.initialize();
  // Fängt die Rückleitung nach dem Anmelden ab.
  const result = await msal.handleRedirectPromise();
  if (result?.account) msal.setActiveAccount(result.account);

  const accounts = msal.getAllAccounts();
  if (!msal.getActiveAccount() && accounts.length) msal.setActiveAccount(accounts[0]);

  return config;
}

export function account() {
  if (mode() === 'local') return localToken() ? { username: 'local' } : null;
  if (mode() === 'simple') return simpleToken() ? { username: 'simple' } : null;
  return msal?.getActiveAccount() || null;
}

// Lokale Anmeldung: Konto und Passwort gegen die Datenbank des Portals. Der
// Fehlertext kommt unveraendert vom Backend — er unterscheidet absichtlich
// nicht zwischen unbekanntem Konto und falschem Passwort.
export async function localSignIn(username, password) {
  const res = await fetch(apiUrl('/api/auth/local'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  sessionStorage.setItem(LOCAL_KEY, data.token);
  return data.user;
}

// Eigenes Passwort aendern. Das Backend stellt dabei ein neues Token aus, weil
// es alle anderen Sitzungen beendet — ohne das waere man selbst mit abgemeldet.
export async function changeOwnPassword(current, next) {
  const res = await authedFetch('/api/auth/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current, next })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  if (data.token) sessionStorage.setItem(LOCAL_KEY, data.token);
  return true;
}

// Einfacher Anmeldeweg: nur ein Name, kein Passwort. Das Backend stellt darauf
// eine kurzlebige Sitzung aus — geprueft wurde nichts, das steht auch so im Log.
export async function simpleSignIn(identity) {
  const res = await fetch(apiUrl('/api/auth/simple'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  sessionStorage.setItem(SIMPLE_KEY, data.token);
  return data.user;
}

export function signIn() {
  return msal.loginRedirect({ scopes: config.apiScope ? [config.apiScope] : ['openid', 'profile'] });
}

export function signOut() {
  if (mode() === 'local') {
    sessionStorage.removeItem(LOCAL_KEY);
    window.location.reload();
    return undefined;
  }
  if (mode() === 'simple') {
    sessionStorage.removeItem(SIMPLE_KEY);
    window.location.reload();
    return undefined;
  }
  return msal.logoutRedirect();
}

async function accessToken() {
  const scopes = config.apiScope ? [config.apiScope] : [`${config.clientId}/.default`];
  try {
    const res = await msal.acquireTokenSilent({ scopes, account: msal.getActiveAccount() });
    return res.accessToken;
  } catch (err) {
    // Abgelaufene Sitzung oder fehlende Zustimmung: nur dann den Nutzer behelligen.
    if (err instanceof InteractionRequiredAuthError) {
      await msal.acquireTokenRedirect({ scopes });
      return null;
    }
    throw err;
  }
}

// Ersatz für fetch: hängt bei aktiver Anmeldung das Token an.
export async function authedFetch(pfad, options = {}) {
  const url = apiUrl(pfad);
  if (mode() === 'local') {
    const headers = { ...(options.headers || {}), Authorization: `Bearer ${localToken()}` };
    return fetch(url, { ...options, headers });
  }
  if (mode() === 'simple') {
    const headers = { ...(options.headers || {}), Authorization: `Bearer ${simpleToken()}` };
    return fetch(url, { ...options, headers });
  }
  if (!config.authEnabled) return fetch(url, options);

  const token = await accessToken();
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
  return fetch(url, { ...options, headers });
}
