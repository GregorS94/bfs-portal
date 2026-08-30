// Anmeldung gegen Entra ID (Microsoft 365).
//
// Die Konfiguration kommt zur Laufzeit vom Backend (/api/config), nicht aus dem
// Build. Dadurch reicht ein Eintrag in der .env und ein Neustart — das Image
// muss nicht neu gebaut werden, wenn Mandant oder Client-ID wechseln.

import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser';

let msal = null;
let config = { authEnabled: false };

export function authConfig() {
  return config;
}

export async function initAuth() {
  const res = await fetch('/api/config');
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
  return msal?.getActiveAccount() || null;
}

export function signIn() {
  return msal.loginRedirect({ scopes: config.apiScope ? [config.apiScope] : ['openid', 'profile'] });
}

export function signOut() {
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
export async function authedFetch(url, options = {}) {
  if (!config.authEnabled) return fetch(url, options);

  const token = await accessToken();
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
  return fetch(url, { ...options, headers });
}
