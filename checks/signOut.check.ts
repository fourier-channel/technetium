// Logout clears what PIP2 says it clears (operator remedy, PIP2 claims sweep
// 2026-10-04): the booru's own sign-out, the picture gate's, the sign-in's
// mx_oidc_* leftovers, and the tokens revoked at the sign-in server.
//
// The request SHAPES are the point, not only that a request went out. A
// cross-origin DELETE, or any header outside the CORS-safelisted set, makes
// the booru request non-simple; its preflight carries no cookies and the
// booru's edge refuses it before Rails sees it -- a sign-out that "ran" and
// did nothing. Revocation with cookies would be refused by the browser
// (the endpoint answers `*`). Each is held here.
import { readFileSync } from 'node:fs'
import {
  OIDC_STATE_PREFIX,
  clearOidcState,
  revokeTokens,
  signOutFailures,
  signOutOfBooru,
  signOutServerSide,
  type FetchAnswer,
  type SignOutCredentials,
  type SignOutDeps,
} from '../src/client/signOut.ts'
import { SESSION_END_REASONS, planSessionEnd } from '../src/client/sessionEnd.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')

type Call = { url: string; init: RequestInit }
function fakeFetch(answer: (url: string, init: RequestInit) => FetchAnswer | Promise<FetchAnswer>) {
  const calls: Call[] = []
  const f = async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return answer(url, init)
  }
  return { f, calls }
}
const ok = (status = 200): FetchAnswer => ({ ok: status >= 200 && status < 300, status })
const ISSUER = 'https://auth.example/'
const META = { revocation_endpoint: 'https://auth.example/oauth2/revoke' }
const metaAnswer = (url: string): FetchAnswer | null =>
  url === 'https://auth.example/.well-known/openid-configuration' ? { ok: true, status: 200, json: async () => META } : null
const CREDS: SignOutCredentials = { accessToken: 'mat_A', refreshToken: 'mar_R', issuer: ISSUER, clientId: 'TCWEB' }
const SAFELISTED = new Set(['accept', 'accept-language', 'content-language', 'content-type'])
const SIMPLE_TYPES = new Set(['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'])
function corsSimple(init: RequestInit): boolean {
  const method = (init.method ?? 'GET').toUpperCase()
  if (!['GET', 'HEAD', 'POST'].includes(method)) return false
  const h = Object.entries((init.headers ?? {}) as Record<string, string>)
  return h.every(([k, v]) => SAFELISTED.has(k.toLowerCase()) && (k.toLowerCase() !== 'content-type' || SIMPLE_TYPES.has(v)))
}

console.log('== the sign-in leftovers in session storage')
{
  const store = new Map<string, string>([
    ['mx_oidc_a', '1'], ['mx_oidc_b', '1'], ['keep_me', '1'], ['mx_oidc_c', '1'], ['net.41chan.x', '1'],
  ])
  const ks = {
    get length() { return store.size },
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => { store.delete(k) },
  }
  const r = clearOidcState(ks)
  check('every mx_oidc_ entry goes, adjacent ones included', r.removed.length === 3 && ![...store.keys()].some((k) => k.startsWith(OIDC_STATE_PREFIX)), [...store.keys()])
  check('nothing else is touched', JSON.stringify([...store.keys()]) === JSON.stringify(['keep_me', 'net.41chan.x']))
  check('and it says nothing failed', r.failed === false)
  const broken = { length: 1, key: () => 'mx_oidc_z', removeItem: () => { throw new Error('denied') } }
  check('a removal that throws is reported, not swallowed', clearOidcState(broken).failed === true)
}

console.log('== the booru: its own sign-out, then the gate')
{
  const { f, calls } = fakeFetch(() => ({ ok: false, status: 0, type: 'opaqueredirect' }))
  const deps: SignOutDeps = { fetch: async (u, i) => (u.endsWith('/fourier/logout') ? ok() : f(u, i)), csrfToken: async () => 'tok+/=', booruOrigin: 'https://booru.example' }
  const seen: Call[] = []
  const r = await signOutOfBooru({ ...deps, fetch: async (u, i) => { seen.push({ url: u, init: i }); return deps.fetch(u, i) } })
  const del = seen[0]
  check('the account sign-out goes to /session first', del?.url === 'https://booru.example/session', seen.map((c) => c.url))
  check('as a POST Rails reads as DELETE, with the form token in the BODY',
    del?.init.method === 'POST' && new URLSearchParams(String(del.init.body)).get('_method') === 'delete' &&
    new URLSearchParams(String(del.init.body)).get('authenticity_token') === 'tok+/=', del?.init)
  check('with the browser\'s cookies, and the redirect not followed', del?.init.credentials === 'include' && del?.init.redirect === 'manual')
  check('and CORS-simple: no preflight for the edge to refuse', corsSimple(del?.init ?? {}), del?.init.headers)
  const gate = seen[1]
  check('then the gate\'s session, POST /fourier/logout, with cookies, CORS-simple',
    gate?.url === 'https://booru.example/fourier/logout' && gate.init.method === 'POST' && gate.init.credentials === 'include' && corsSimple(gate.init), gate)
  check('an opaque redirect (the booru\'s 303) counts as signed out', r[0].ok === true && r[0].step === 'booru', r)
  check('a 200 from the gate counts', r[1].ok === true && r[1].step === 'gate', r)
  void calls
}
{
  const r = await signOutOfBooru({ fetch: async (u) => (u.endsWith('/session') ? ok(422) : ok(500)), csrfToken: async () => 't', booruOrigin: 'https://b' })
  check('a refused form token is a failure that names its status', !r[0].ok && r[0].detail === 'HTTP 422', r[0])
  check('a gate error is a failure that names its status', !r[1].ok && r[1].detail === 'HTTP 500', r[1])
}
{
  const seen: string[] = []
  const r = await signOutOfBooru({ fetch: async (u) => { seen.push(u); return ok() }, csrfToken: async () => null, booruOrigin: 'https://b' })
  check('no form token: the account sign-out is NOT sent, and says why', !r[0].ok && /form token/.test(r[0].detail) && !seen.includes('https://b/session'), { r, seen })
  check('and the gate is still signed out', r[1].ok && seen.includes('https://b/fourier/logout'))
}
{
  const r = await signOutOfBooru({ fetch: async () => { throw new TypeError('network') }, csrfToken: async () => 't', booruOrigin: 'https://b' })
  check('no answer at all is a failure on each step, never a throw', r.length === 2 && r.every((x) => !x.ok && x.detail === 'no answer'), r)
}

console.log('== the tokens, revoked at the sign-in server')
{
  const { f, calls } = fakeFetch((u) => metaAnswer(u) ?? ok())
  const r = await revokeTokens(CREDS, f)
  const posts = calls.filter((c) => c.init.method === 'POST')
  check('the endpoint comes from the issuer\'s own metadata', calls[0]?.url === 'https://auth.example/.well-known/openid-configuration', calls[0])
  check('refresh token first, then the access token, both to that endpoint',
    posts.length === 2 && posts.every((p) => p.url === META.revocation_endpoint) &&
    new URLSearchParams(String(posts[0].init.body)).get('token') === 'mar_R' &&
    new URLSearchParams(String(posts[0].init.body)).get('token_type_hint') === 'refresh_token' &&
    new URLSearchParams(String(posts[1].init.body)).get('token') === 'mat_A', posts.map((p) => String(p.init.body)))
  check('naming this client, as a public client must', posts.every((p) => new URLSearchParams(String(p.init.body)).get('client_id') === 'TCWEB'))
  check('without cookies (the endpoint answers *, which a browser will not pair with credentials)', posts.every((p) => p.init.credentials === 'omit'))
  check('accepted is ok', r.ok && r.step === 'tokens', r)
}
{
  const { f, calls } = fakeFetch((u) => metaAnswer(u) ?? ok(503))
  const r = await revokeTokens(CREDS, f)
  check('a refusal is a failure naming each token and status', !r.ok && /refresh token: HTTP 503/.test(r.detail) && /access token: HTTP 503/.test(r.detail), r)
  check('and the second token is still tried after the first fails', calls.filter((c) => c.init.method === 'POST').length === 2)
}
{
  const { f, calls } = fakeFetch((u) => (u.includes('.well-known') ? { ok: true, status: 200, json: async () => ({ revocation_endpoint: 'javascript:alert(1)' }) } : ok()))
  const r = await revokeTokens(CREDS, f)
  check('an endpoint that is not http(s) is refused, and nothing is sent to it', !r.ok && calls.length === 1, { r, calls: calls.map((c) => c.url) })
}
{
  const { f, calls } = fakeFetch(() => ok())
  const none = await revokeTokens({ ...CREDS, accessToken: null, refreshToken: null }, f)
  check('no token held: nothing to revoke, no request', none.ok && calls.length === 0, none)
  const noIssuer = await revokeTokens({ ...CREDS, issuer: null }, f)
  check('a token with no issuer on record cannot be revoked, and says so', !noIssuer.ok && /not on record/.test(noIssuer.detail) && calls.length === 0, noIssuer)
}

console.log('== all of it, and what the screen says')
{
  const r = await signOutServerSide(CREDS, {
    fetch: async (u, i) => metaAnswer(u) ?? (u.endsWith('/session') ? { ok: false, status: 0, type: 'opaqueredirect' } : u.endsWith('/fourier/logout') ? { ok: false, status: 502 } : ok(i.method === 'POST' ? 200 : 404)),
    csrfToken: async () => 't',
    booruOrigin: 'https://b',
  })
  check('three steps, one result each', JSON.stringify(r.map((x) => x.step)) === JSON.stringify(['booru', 'gate', 'tokens']), r)
  check('one failing does not stop the others', r[0].ok && !r[1].ok && r[2].ok, r)
  const f = signOutFailures(r, 'https://b', ISSUER)
  check('only the failure is reported, with its remedy and where to do it',
    f.length === 1 && f[0].step === 'gate' && /HTTP 502/.test(f[0].text) && /Purge on the booru/.test(f[0].text) && f[0].href === 'https://b', f)
  const t = signOutFailures([{ step: 'tokens', ok: false, detail: 'no answer' }], 'https://b', ISSUER)
  check('an unrevoked sign-in points at the account page\'s session list', t[0].href === 'https://auth.example/account/?action=org.matrix.sessions_list', t)
  const all = signOutFailures([{ step: 'booru', ok: false, detail: 'x' }, { step: 'gate', ok: false, detail: 'x' }, { step: 'tokens', ok: false, detail: 'x' }], 'https://b', null)
  check('every failure text names what to do, ASCII only', all.every((x) => /\. [A-Z][^.]*\.$/.test(x.text) && /^[\x20-\x7e]+$/.test(x.text)), all.map((x) => x.text))
}

console.log('== which endings do the server-side half')
for (const reason of SESSION_END_REASONS) {
  const p = planSessionEnd(reason)
  check(`${reason}: the mx_oidc_ leftovers are cleared`, p.clearOidcState === true)
}
check('logout, purge and revoked sign out of the booru and revoke',
  ['logout', 'purge', 'revoked'].every((r) => planSessionEnd(r as 'logout').signOutServerSide === true))
check('foreign tokens NEVER revoke: they are another tab\'s live login', planSessionEnd('foreign_tokens').signOutServerSide === false)
check('a failed resume does not either (presumed dead, user coming straight back)', planSessionEnd('resume_failed').signOutServerSide === false)

console.log('== the teardown, read from source')
{
  const ctx = read('src/client/ClientContext.tsx')
  const body = ctx.slice(ctx.indexOf('function endSession('), ctx.indexOf('const logout ='))
  check('the credentials are read BEFORE the stored session is cleared',
    body.indexOf('const stored = loadSession()') > 0 && body.indexOf('const stored = loadSession()') < body.indexOf('clearSession()') &&
    body.indexOf('c?.getRefreshToken()') > 0 && body.indexOf('c?.getRefreshToken()') < body.indexOf('clearSession()'))
  check('the local sign-out finishes before anything goes over the network',
    body.indexOf("setStatus('awaiting_login')") < body.indexOf('signOutServerSide(creds'))
  check('the server half runs only when the plan says so', /if \(!plan\.signOutServerSide\) return Promise\.resolve\(\[\]\)/.test(body))
  check('mx_oidc_ state is cleared from session storage when the plan says so', /if \(plan\.clearOidcState\)[\s\S]*clearOidcState\(window\.sessionStorage\)/.test(body))
  check('the booru memos are dropped after it, whatever happened', /resetBooruSession\(\)\s*\n\s*resetBooruCsrf\(\)/.test(body))
  const purge = ctx.slice(ctx.indexOf('const purge = async'), ctx.indexOf('// The server has rejected'))
  check('purge WAITS for the server half before purging and reloading (a reload cancels it)',
    /const serverFailures = await endSession\('purge'\)/.test(purge) && purge.indexOf('await endSession') < purge.indexOf('executePurge('))
  check('and a server failure reaches the error screen rather than a clean reload',
    /failed\.length === 0 && serverFailures\.length === 0/.test(purge) && /for \(const f of serverFailures\) parts\.push\(f\.text\)/.test(purge))
  check('the landing says how it went', /<SignOutStatus \/>/.test(read('src/onboarding/AuthLanding.tsx')))
  const status = read('src/index.css')
  const rule = status.slice(status.indexOf('.tc-signout-status {'), status.indexOf('}', status.indexOf('.tc-signout-status {')))
  check('and says it out of flow, so the doors do not move when it lands', /position: fixed;/.test(rule) && /box-sizing: border-box;/.test(rule) && /100vw/.test(rule), rule)
}

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nsign-out: all checks passed')
