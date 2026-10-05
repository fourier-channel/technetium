// ---------------------------------------------------------------------------
// Signing out on the servers' side: what a logout does beyond this browser.
//
// PIP2 says logging out "automatically clears that data, wherever possible".
// Until 2026-10-05 a Technetium logout cleared its own session record and sync
// cache and nothing else: the booru stayed signed in, the picture gate kept its
// session, the sign-in's leftovers sat in session storage, and the tokens stayed
// live on the sign-in server until someone ended them by hand (PIP2 claims
// sweep, 2026-10-04). This module is the rest of it, as three steps:
//
//   booru   -- the booru account's own sign-out, the call its Purge makes
//              (chanbooru modulation_site_reset.js: DELETE /session). Sent as
//              a POST carrying `_method=delete`, which Rails reads as DELETE:
//              a real DELETE from this origin is CORS-non-simple, its
//              preflight carries no cookies, and the booru's edge refuses it
//              before Rails is asked (booruCsrf.ts, measured 2026-09-19). The
//              form token rides in the body for the same reason.
//   gate    -- the picture gate's session, POST /fourier/logout, the booru
//              purge's second call. The gate destroys it and expires its cookie.
//   tokens  -- RFC 7009 revocation at the sign-in server, refresh token first
//              (ending it ends the whole session there, and with it this
//              device), then the access token.
//
// WHAT A GREEN HERE PROVES, and what it does not. A revocation endpoint answers
// 200 for a token it does not know (RFC 7009 2.2; MAS does, measured with a
// made-up token 2026-10-05), so 200 proves the request reached the server and
// was accepted -- not that a live session ended. Nothing a public client holds
// can ask afterwards: the revoked token is the only credential it had. The
// booru and gate answers are their own words about their own sessions.
//
// Every step runs whatever the others did, and every failure comes back as a
// sentence that says what did not happen and how to finish it by hand (G-tc05;
// memory errors-must-carry-their-own-remedy). The local sign-out never waits
// on any of it: ClientContext has already forgotten the session before this
// starts.
//
// Pure apart from the fetch and the token source handed in, so the checks
// drive it.
// ---------------------------------------------------------------------------

// The SDK and oidcAuthorize.ts keep the sign-in's in-flight state (the PKCE
// verifier, the nonce, the state the server echoes) under this prefix in
// session storage. Spent once the login completes, and left behind by it.
export const OIDC_STATE_PREFIX = 'mx_oidc_'

export interface KeyedStore {
  readonly length: number
  key(i: number): string | null
  removeItem(k: string): void
}

// Every mx_oidc_* entry, removed. Keys are collected FIRST: removing while
// walking by index skips the entry that slides into the removed one's place.
export function clearOidcState(store: KeyedStore): { removed: string[]; failed: boolean } {
  const keys: string[] = []
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)
      if (k !== null && k.startsWith(OIDC_STATE_PREFIX)) keys.push(k)
    }
  } catch {
    return { removed: [], failed: true }
  }
  const removed: string[] = []
  let failed = false
  for (const k of keys) {
    try {
      store.removeItem(k)
      removed.push(k)
    } catch {
      failed = true
    }
  }
  return { removed, failed }
}

export interface SignOutCredentials {
  accessToken: string | null
  refreshToken: string | null
  // The sign-in server, and this client's id there: revocation names both.
  issuer: string | null
  clientId: string | null
}

export type SignOutStep = 'booru' | 'gate' | 'tokens'

export interface SignOutStepResult {
  step: SignOutStep
  ok: boolean
  // What happened, in a few words: an HTTP status, "no answer", or why the
  // step could not be attempted at all.
  detail: string
}

export interface FetchAnswer {
  ok: boolean
  status: number
  type?: string
  json?: () => Promise<unknown>
}
export type SignOutFetch = (url: string, init: RequestInit) => Promise<FetchAnswer>

export interface SignOutDeps {
  fetch: SignOutFetch
  // The booru's form token, read fresh: one cached from an older booru
  // session no longer validates.
  csrfToken: () => Promise<string | null>
  booruOrigin: string
}

const status = (r: FetchAnswer) => (r.type === 'opaqueredirect' ? 'a redirect' : `HTTP ${r.status}`)

// The booru answers its sign-out with a 303 to its front page. Not followed
// (`redirect: 'manual'` hands back an opaque redirect instead), because
// following it would load the booru's front page for nothing.
function booruAccepted(r: FetchAnswer): boolean {
  return r.type === 'opaqueredirect' || (r.status >= 200 && r.status < 400)
}

export async function signOutOfBooru(deps: SignOutDeps): Promise<SignOutStepResult[]> {
  const out: SignOutStepResult[] = []
  let token: string | null
  try {
    token = await deps.csrfToken()
  } catch {
    token = null
  }
  if (!token) {
    out.push({ step: 'booru', ok: false, detail: "its form token could not be read, so the sign-out was not sent" })
  } else {
    try {
      const body = new URLSearchParams({ _method: 'delete', authenticity_token: token })
      const r = await deps.fetch(`${deps.booruOrigin}/session`, {
        method: 'POST',
        credentials: 'include',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' },
        body: body.toString(),
      })
      out.push({ step: 'booru', ok: booruAccepted(r), detail: status(r) })
    } catch {
      out.push({ step: 'booru', ok: false, detail: 'no answer' })
    }
  }
  try {
    const r = await deps.fetch(`${deps.booruOrigin}/fourier/logout`, { method: 'POST', credentials: 'include' })
    out.push({ step: 'gate', ok: r.ok, detail: status(r) })
  } catch {
    out.push({ step: 'gate', ok: false, detail: 'no answer' })
  }
  return out
}

// Where this sign-in server takes revocations, from its own published
// metadata. Only an http(s) URL is used: the answer comes off the network.
async function revocationEndpoint(issuer: string, fetchImpl: SignOutFetch): Promise<string | null> {
  const r = await fetchImpl(new URL('.well-known/openid-configuration', issuer).toString(), { method: 'GET' })
  if (!r.ok || !r.json) return null
  const meta = (await r.json()) as { revocation_endpoint?: unknown } | null
  const url = meta?.revocation_endpoint
  if (typeof url !== 'string') return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

export async function revokeTokens(creds: SignOutCredentials, fetchImpl: SignOutFetch): Promise<SignOutStepResult> {
  const tokens: [string, 'refresh_token' | 'access_token'][] = []
  if (creds.refreshToken) tokens.push([creds.refreshToken, 'refresh_token'])
  if (creds.accessToken) tokens.push([creds.accessToken, 'access_token'])
  if (tokens.length === 0) return { step: 'tokens', ok: true, detail: 'no token was held' }
  if (!creds.issuer || !creds.clientId) {
    return { step: 'tokens', ok: false, detail: 'the sign-in server this session came from is not on record' }
  }
  let endpoint: string | null
  try {
    endpoint = await revocationEndpoint(creds.issuer, fetchImpl)
  } catch {
    endpoint = null
  }
  if (!endpoint) return { step: 'tokens', ok: false, detail: 'the sign-in server did not say where to send it' }
  const refused: string[] = []
  for (const [token, hint] of tokens) {
    try {
      // No cookies: the endpoint answers any origin (`*`), which a browser
      // refuses to pair with credentials, and a public client has none to send.
      const r = await fetchImpl(endpoint, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token, token_type_hint: hint, client_id: creds.clientId }).toString(),
      })
      if (!r.ok) refused.push(`${hint === 'refresh_token' ? 'refresh' : 'access'} token: ${status(r)}`)
    } catch {
      refused.push(`${hint === 'refresh_token' ? 'refresh' : 'access'} token: no answer`)
    }
  }
  return refused.length === 0
    ? { step: 'tokens', ok: true, detail: 'accepted' }
    : { step: 'tokens', ok: false, detail: refused.join('; ') }
}

// All three, concurrently: the booru pair and the revocation do not depend on
// each other, and a user watching the landing should wait for the slower one
// only.
export async function signOutServerSide(creds: SignOutCredentials, deps: SignOutDeps): Promise<SignOutStepResult[]> {
  const [booru, tokens] = await Promise.all([signOutOfBooru(deps), revokeTokens(creds, deps.fetch)])
  return [...booru, tokens]
}

export interface SignOutFailure {
  step: SignOutStep
  text: string
  // Where to finish it by hand, when there is a page for that.
  href: string | null
}

// What did not happen, each with its remedy.
//
// The booru pair is phrased "if you were signed in there": this browser cannot
// see the booru's cookies, so a browser that never had a booru session (a
// signed-out purge on a fresh browser, say) is refused at the booru's edge
// exactly as a real failure would be. The sentence says what was not
// confirmed, and does not claim a session existed.
export function signOutFailures(results: readonly SignOutStepResult[], booruOrigin: string, issuer: string | null): SignOutFailure[] {
  return results.filter((r) => !r.ok).map((r) => {
    switch (r.step) {
      case 'booru':
        return {
          step: r.step,
          text: `The booru did not confirm you are signed out of it (${r.detail}). If you were signed in there, open the booru and use its Purge, or sign out from its Manage Session card.`,
          href: booruOrigin,
        }
      case 'gate':
        return {
          step: r.step,
          text: `The booru's picture gate did not confirm it ended your session there (${r.detail}). If you had one, it ends by itself within a day; Purge on the booru ends it now.`,
          href: booruOrigin,
        }
      case 'tokens':
        return {
          step: r.step,
          text: `The sign-in server did not confirm it ended this sign-in (${r.detail}). End it from the session list on your account page.`,
          href: issuer ? `${issuer}account/?action=org.matrix.sessions_list` : null,
        }
    }
  })
}

// What the signed-out screen says while this runs and once it has.
export type SignOutProgress =
  | { phase: 'running' }
  | { phase: 'done'; failures: SignOutFailure[] }

export const SIGN_OUT_RUNNING = 'Signing you out of the booru and ending this sign-in on the server...'
export const SIGN_OUT_DONE =
  'Signed out of Technetium and the booru, and the sign-in server accepted the end of this sign-in. Your settings and encryption keys stay in this browser; Purge removes the settings too.'
