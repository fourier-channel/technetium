// This account's sessions as MAS sees them, and ending them in bulk.
//
// Under MSC3861 the homeserver no longer owns sessions: /delete_devices
// answers 404 M_UNRECOGNIZED and MAS's account page is the sanctioned way to
// end one -- one at a time, each behind its own confirmation, which for an
// account with ninety sessions is not a feature. MAS also serves a GraphQL
// API on the issuer, answers it cross-origin with a bearer token, and grants
// it to any access token carrying the `urn:mas:graphql:*` scope, which this
// client now requests at login (oidcAuthorize.ts). That is the whole
// mechanism: list, then end, as the user, with the token already held.
//
// A token from a login before the scope was requested is answered as
// Anonymous. That is reported as 'no-scope' and the panel says to sign in
// again; it is never retried with anything else.
import type { PurgeableSession } from './sessionPurgePlan'

export const MAS_GRAPHQL_PATH = 'graphql'

export type ListOutcome = PurgeableSession[] | 'no-scope' | 'failed'

interface GqlResponse<T> { data?: T; errors?: { message: string }[] }

async function gql<T>(issuer: string, token: string, query: string, variables: Record<string, unknown>): Promise<T | null> {
  const res = await fetch(new URL(MAS_GRAPHQL_PATH, issuer).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) return null
  const body = (await res.json()) as GqlResponse<T>
  if (body.errors?.length || !body.data) {
    console.warn('[mas] graphql errors', body.errors)
    return null
  }
  return body.data
}

interface UserAgent { name: string | null; os: string | null }
interface CompatNode { id: string; deviceId: string | null; humanName: string | null; userAgent: UserAgent | null; lastActiveAt: string | null; createdAt: string }
interface OauthNode { id: string; scope: string; humanName: string | null; userAgent: UserAgent | null; client: { clientName: string | null } | null; lastActiveAt: string | null; createdAt: string }
interface Page<N> { edges: { node: N }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
interface ViewerPage {
  viewer: { __typename: string; compatSessions?: Page<CompatNode>; oauth2Sessions?: Page<OauthNode> }
}

const LIST = `query($after: String) {
  viewer { __typename
    ... on User {
      compatSessions(state: ACTIVE, first: 100, after: $after) {
        edges { node { id deviceId humanName lastActiveAt createdAt userAgent { name os } } }
        pageInfo { hasNextPage endCursor }
      }
      oauth2Sessions(state: ACTIVE, first: 100, after: $after) {
        edges { node { id scope humanName lastActiveAt createdAt userAgent { name os } client { clientName } } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`

const DEVICE_SCOPE = 'urn:matrix:org.matrix.msc2967.client:device:'

export function deviceIdFromScope(scope: string): string | null {
  const tok = scope.split(' ').find((s) => s.startsWith(DEVICE_SCOPE))
  return tok ? tok.slice(DEVICE_SCOPE.length) || null : null
}

function label(name: string | null, ua: UserAgent | null, client: string | null): string {
  if (name) return name
  const parts = [client, ua?.name, ua?.os].filter((p): p is string => !!p)
  return parts.length ? parts.join(' on ') : 'unnamed session'
}

// Both connections are paged with the same cursor variable, which is wrong
// the moment either has more than one page: the cursors are per-connection.
// So each is walked on its own, one connection per query, and the other is
// simply not selected.
async function walk<N>(
  issuer: string, token: string, field: 'compatSessions' | 'oauth2Sessions',
): Promise<N[] | 'no-scope' | null> {
  const query = LIST.replace(field === 'compatSessions' ? /oauth2Sessions[\s\S]*?pageInfo \{ hasNextPage endCursor \}\n\s*\}/ : /compatSessions[\s\S]*?pageInfo \{ hasNextPage endCursor \}\n\s*\}/, '')
  const out: N[] = []
  let after: string | null = null
  for (let guard = 0; guard < 50; guard++) {
    const data = await gql<ViewerPage>(issuer, token, query, { after })
    if (!data) return null
    if (data.viewer.__typename !== 'User') return 'no-scope'
    const page = data.viewer[field] as Page<N> | undefined
    if (!page) return null
    for (const e of page.edges) out.push(e.node)
    if (!page.pageInfo.hasNextPage) break
    after = page.pageInfo.endCursor
    if (!after) break
  }
  return out
}

export async function listSessions(issuer: string, token: string): Promise<ListOutcome> {
  try {
    const compat = await walk<CompatNode>(issuer, token, 'compatSessions')
    if (compat === 'no-scope') return 'no-scope'
    const oauth = await walk<OauthNode>(issuer, token, 'oauth2Sessions')
    if (oauth === 'no-scope') return 'no-scope'
    if (!compat || !oauth) return 'failed'
    const out: PurgeableSession[] = []
    for (const c of compat) {
      out.push({ id: c.id, kind: 'compat', deviceId: c.deviceId, label: label(c.humanName, c.userAgent, null), lastActiveAt: c.lastActiveAt })
    }
    for (const o of oauth) {
      out.push({ id: o.id, kind: 'oauth', deviceId: deviceIdFromScope(o.scope), label: label(o.humanName, o.userAgent, o.client?.clientName ?? null), lastActiveAt: o.lastActiveAt })
    }
    return out
  } catch (err) {
    console.error('[mas] listing sessions failed', err)
    return 'failed'
  }
}

const END_COMPAT = `mutation($id: ID!) { endCompatSession(input: { compatSessionId: $id }) { status } }`
const END_OAUTH = `mutation($id: ID!) { endOauth2Session(input: { oauth2SessionId: $id }) { status } }`

export interface EndResult { ended: number; failed: number }

// One mutation per session, sequentially: MAS rate-limits, and a failure in
// the middle must leave a countable result rather than a rejected batch.
export async function endSessions(issuer: string, token: string, sessions: readonly PurgeableSession[]): Promise<EndResult> {
  let ended = 0
  let failed = 0
  for (const s of sessions) {
    try {
      const data = await gql<{ endCompatSession?: { status: string }; endOauth2Session?: { status: string } }>(
        issuer, token, s.kind === 'compat' ? END_COMPAT : END_OAUTH, { id: s.id },
      )
      const status = data?.endCompatSession?.status ?? data?.endOauth2Session?.status
      if (status === 'ENDED') ended++
      else failed++
    } catch {
      failed++
    }
  }
  return { ended, failed }
}
