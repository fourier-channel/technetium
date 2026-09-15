import type { MatrixClient } from 'matrix-js-sdk'
import { reportIgnored } from './report'
import type { TokenSource } from './masSessions'

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
    // The clean no. Synapse answers 403 M_FORBIDDEN to a non-administrator.
    if (res.status === 403) {
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
