// Session persistence for the OIDC-authenticated Matrix client.
import { reportIgnored } from './report'
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
  // The life of each token, for Manage session (PIP2: "the life of any given
  // token is displayed"). Epoch milliseconds. Written at sign-in and at every
  // refresh; ABSENT on a record from before 2026-10-05, which the panel says
  // rather than inventing a time.
  //
  // When the access token stops being accepted: the server's expires_in,
  // counted from when the request was SENT, so it errs early, never late.
  accessTokenExpiresAt?: number
  // When the refresh token now held was issued. It has no expiry of its own:
  // it is spent and replaced when the access token renews, and ends at logout.
  refreshTokenIssuedAt?: number
}

// Who is watching the record (Manage session), so a refresh that rewrites it
// is seen at once rather than at the next open. Same-tab only, on purpose: the
// record another tab writes is that tab's login (sessionIdentity.ts).
const listeners = new Set<() => void>()
function changed(): void {
  for (const f of listeners) f()
}

export function subscribeSession(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

// The record as stored, for useSyncExternalStore: a string compares by value,
// so the snapshot is stable until the record actually changes.
export function storedSessionRaw(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch (err) {
    reportIgnored('session: read raw', err)
    return null
  }
}

export function parseSession(raw: string | null): StoredSession | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredSession
  } catch {
    return null
  }
}

export function saveSession(session: StoredSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  changed()
}

export function loadSession(): StoredSession | null {
  const raw = localStorage.getItem(SESSION_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredSession
  } catch (err) {
    reportIgnored('session: read', err)
    // Corrupt entry -- treat as no session rather than crashing on load.
    localStorage.removeItem(SESSION_KEY)
    return null
  }
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY)
  changed()
}
