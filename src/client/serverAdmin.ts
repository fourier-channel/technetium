import type { MatrixClient } from 'matrix-js-sdk'
import { reportIgnored } from './report'
import { MAS_GRAPHQL_PATH, type TokenSource } from './masSessions'

// ---------------------------------------------------------------------------
// "Am I a server administrator?" (ui-depth-v1 U8)
//
// Asked of the server, not guessed from power levels. Synapse's admin API
// answers it directly: GET /_synapse/admin/v1/users/<id>/admin returns
// { admin: true|false } to an administrator and 403 to everyone else. A
// non-admin therefore gets a clean, cheap no.
//
// WHAT THIS IS AND IS NOT, stated plainly because the distinction matters and
// a reader will assume the stronger one:
//
//   It is a VISIBILITY switch. The Server Permissions panel shows room state
//   the client has already synced -- names, join rules, power levels, who holds
//   what. Every byte of it is readable by any member of those rooms through any
//   Matrix client. Hiding the panel hides a convenient VIEW, and nothing else.
//
//   It is NOT access control. The operator's "any way to make this show up for
//   me only?" is answered honestly by this, and the answer would be a lie if it
//   implied the data were protected. Anything that must actually be restricted
//   is restricted by the homeserver, not by which tab a client draws.
//
// UNDER DELEGATED AUTH A 403 IS NOT A NO (found 2026-09-28, never seen live
// before then). This server runs MSC3861: MAS owns sign-in, and Synapse's
// MasDelegatedAuth.is_server_admin is `"urn:synapse:admin:*" in
// requester.scope` -- a property of the TOKEN, not of the account. Technetium
// does not ask for that scope and must not (MAS refuses it at sign-in to
// anyone without can_request_admin, so asking would break every other
// account's login). So Synapse answers 403 to the operator exactly as it does
// to anyone, and the admin tabs never appeared for the one account they were
// built for.
//
// The account-level fact lives in MAS: `canRequestAdmin` on the viewer, which
// is what MAS consults before it will issue the admin scope, and what syn2mas
// fills from Synapse's own users.admin when a server migrates. The token
// already carries the GraphQL scope (masSessions.ts), so a 403 from Synapse is
// followed by asking MAS -- when there is a MAS to ask. With no issuer (a
// server without delegated auth), the 403 means what it always meant.
//
// Three outcomes, and the third is not the second. 'unknown' means the question
// could not be put -- no network, a homeserver that is not Synapse, an admin
// API that is not exposed. An unmeasured axis must never render as a measured
// one (VERIFICATION-DOCTRINE rule 8), so the panel says which of the three it
// got rather than folding 'unknown' into 'no'.
// ---------------------------------------------------------------------------

export type AdminVerdict = 'admin' | 'not-admin' | 'unknown'

export interface AdminFacts {
  verdict: AdminVerdict
  // Why, in the user's terms. Always set, including for 'admin', so a panel can
  // show its own provenance rather than appearing by magic.
  because: string
}

const ADMIN_PATH = '_synapse/admin/v1/users'

export async function observeServerAdmin(
  client: MatrixClient,
  source: TokenSource,
  // Injectable so a check can drive it; defaults to the real one.
  doFetch: typeof fetch = fetch,
  // The OIDC issuer this session signed in through, if any. Present means the
  // server delegates auth, and a 403 below is asked again of MAS.
  masIssuer: string | null = null,
): Promise<AdminFacts> {
  const userId = client.getUserId()
  const base = client.baseUrl
  if (!userId || !base) {
    return { verdict: 'unknown', because: 'No signed-in account to ask about.' }
  }

  const url = new URL(`${ADMIN_PATH}/${encodeURIComponent(userId)}/admin`, base.endsWith('/') ? base : base + '/').toString()

  // Two attempts, for the same reason masSessions does it: an access token here
  // lives five minutes and the SDK only refreshes one when the HOMESERVER
  // rejects it, so the first call after an idle spell is a coin toss.
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = source.get()
    if (!token) return { verdict: 'unknown', because: 'No access token to ask with.' }
    let res: Response
    try {
      res = await doFetch(url, { headers: { Authorization: `Bearer ${token}` } })
    } catch (err) {
      reportIgnored('server admin probe: network', err)
      return { verdict: 'unknown', because: 'The homeserver could not be reached to ask.' }
    }
    if (res.status === 401 && attempt === 0) {
      await source.refresh()
      continue
    }
    if (res.status === 401) {
      return { verdict: 'unknown', because: 'The homeserver would not accept this session to ask with.' }
    }
    // Without delegated auth, the clean no: Synapse answers 403 M_FORBIDDEN to
    // a non-administrator. With it, only "this token cannot administer" --
    // see the top of this file -- so the account is asked about at MAS.
    if (res.status === 403) {
      if (masIssuer) return observeMasAdmin(masIssuer, source, doFetch)
      return { verdict: 'not-admin', because: 'The homeserver says this account is not a server administrator.' }
    }
    // Not Synapse, or the admin API is not exposed on this listener. That is
    // not a no -- it is a question that could not be put.
    if (res.status === 404 || res.status === 400) {
      return { verdict: 'unknown', because: 'This homeserver does not answer the administrator API.' }
    }
    if (!res.ok) {
      return { verdict: 'unknown', because: `The homeserver answered ${res.status} when asked.` }
    }
    let body: unknown
    try {
      body = await res.json()
    } catch (err) {
      reportIgnored('server admin probe: body', err)
      return { verdict: 'unknown', because: 'The homeserver answered with something that was not an answer.' }
    }
    return readAdminBody(body)
  }
  return { verdict: 'unknown', because: 'The homeserver would not accept this session to ask with.' }
}

// Split out so the shape of the answer is checkable without a server. A body
// that does not say `admin: true` is NOT an admin -- go-fish, and the safe
// reading of a malformed answer is the narrower one.
export function readAdminBody(body: unknown): AdminFacts {
  if (!body || typeof body !== 'object') {
    return { verdict: 'unknown', because: 'The homeserver answered with something that was not an answer.' }
  }
  const admin = (body as { admin?: unknown }).admin
  if (admin === true) {
    return { verdict: 'admin', because: 'The homeserver says this account is a server administrator.' }
  }
  if (admin === false) {
    return { verdict: 'not-admin', because: 'The homeserver says this account is not a server administrator.' }
  }
  return { verdict: 'unknown', because: 'The homeserver answered without saying either way.' }
}

const MAS_ADMIN_QUERY = 'query { viewer { __typename ... on User { canRequestAdmin } } }'

// The account's admin flag as MAS holds it. Same retry rule as the Synapse
// probe above and as masSessions.ts: a five-minute token is refreshed once on
// 401 and never looped on.
export async function observeMasAdmin(
  issuer: string,
  source: TokenSource,
  doFetch: typeof fetch = fetch,
): Promise<AdminFacts> {
  const url = new URL(MAS_GRAPHQL_PATH, issuer.endsWith('/') ? issuer : issuer + '/').toString()
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = source.get()
    if (!token) return { verdict: 'unknown', because: 'No access token to ask the sign-in service with.' }
    let res: Response
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query: MAS_ADMIN_QUERY }),
      })
    } catch (err) {
      reportIgnored('server admin probe: mas network', err)
      return { verdict: 'unknown', because: 'The sign-in service could not be reached to ask.' }
    }
    if (res.status === 401 && attempt === 0) {
      await source.refresh()
      continue
    }
    if (!res.ok) {
      return { verdict: 'unknown', because: `The sign-in service answered ${res.status} when asked.` }
    }
    let body: unknown
    try {
      body = await res.json()
    } catch (err) {
      reportIgnored('server admin probe: mas body', err)
      return { verdict: 'unknown', because: 'The sign-in service answered with something that was not an answer.' }
    }
    return readMasAdminBody(body)
  }
  return { verdict: 'unknown', because: 'The sign-in service would not accept this session to ask with.' }
}

// Split out for the same reason as readAdminBody. Anonymous is what MAS says to
// a token WITHOUT the GraphQL scope -- a sign-in from before Technetium asked
// for it -- and that is a question that could not be put, not a no.
export function readMasAdminBody(body: unknown): AdminFacts {
  const viewer = (body as { data?: { viewer?: { __typename?: unknown; canRequestAdmin?: unknown } } } | null)?.data?.viewer
  if (!viewer || typeof viewer !== 'object') {
    return { verdict: 'unknown', because: 'The sign-in service answered without saying either way.' }
  }
  if (viewer.__typename === 'Anonymous') {
    return { verdict: 'unknown', because: 'This sign-in cannot ask the sign-in service; signing out and in again would let it.' }
  }
  if (viewer.__typename !== 'User') {
    return { verdict: 'unknown', because: 'The sign-in service answered without saying either way.' }
  }
  if (viewer.canRequestAdmin === true) {
    return { verdict: 'admin', because: 'The sign-in service says this account is a server administrator.' }
  }
  if (viewer.canRequestAdmin === false) {
    return { verdict: 'not-admin', because: 'The sign-in service says this account is not a server administrator.' }
  }
  return { verdict: 'unknown', because: 'The sign-in service answered without saying either way.' }
}
