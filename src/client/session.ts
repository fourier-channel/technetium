// Session persistence for the OIDC-authenticated Matrix client.
//
// Stores exactly what's needed to rebuild and refresh the client on reload:
// the homeserver URL, the access/refresh tokens, the user/device identity, and
// the OIDC settings (issuer + clientId + idTokenClaims) required by the token
// refresher. Persisted to localStorage under one key.
//
// Note: access/refresh tokens live in localStorage, the standard tradeoff for a
// web Matrix client (an XSS bug could read them). Acceptable for this dev client;
// revisit before opening to untrusted users.

const SESSION_KEY = 'matrix-client:session'

export interface StoredSession {
  homeserverUrl: string
  accessToken: string
  refreshToken?: string
  userId: string
  deviceId: string
  // OIDC bits needed to refresh the access token when it expires (Step 4).
  oidc: {
    issuer: string
    clientId: string
    redirectUri: string
    idTokenClaims: unknown
  }
}

export function saveSession(session: StoredSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function loadSession(): StoredSession | null {
  const raw = localStorage.getItem(SESSION_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredSession
  } catch {
    // Corrupt entry — treat as no session rather than crashing on load.
    localStorage.removeItem(SESSION_KEY)
    return null
  }
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY)
}
