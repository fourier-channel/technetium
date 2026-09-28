// Checks for the server-administrator probe (ui-depth-v1 U8).
//
// Three outcomes, and the whole point is that the third is not the second.
// 'unknown' means the question could not be PUT -- no network, a homeserver
// that is not Synapse, an admin API that is not exposed. Folding that into
// 'no' would make an unmeasured axis indistinguishable from a measured one,
// which is rule 8 of the doctrine, and it would do it on the axis that decides
// whether a panel exists.
import { observeServerAdmin, readAdminBody, readMasAdminBody } from '../src/client/serverAdmin.ts'

let failures = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

console.log('\n-- reading the answer --')
{
  check('admin true is admin', readAdminBody({ admin: true }).verdict === 'admin')
  check('admin false is not-admin', readAdminBody({ admin: false }).verdict === 'not-admin')

  // Go-fish: an answer that does not say either way has not answered. The safe
  // reading of a malformed body is the narrower one, and 'unknown' is narrower
  // than 'admin'.
  check('a missing field is unknown', readAdminBody({}).verdict === 'unknown')
  check('a string is unknown', readAdminBody({ admin: 'true' }).verdict === 'unknown')
  check('a number is unknown', readAdminBody({ admin: 1 }).verdict === 'unknown')
  check('null is unknown', readAdminBody(null).verdict === 'unknown')
  check('a bare string body is unknown', readAdminBody('yes').verdict === 'unknown')

  // Every verdict carries its reason, including the yes: a panel that appears
  // by magic cannot show its own provenance.
  for (const body of [{ admin: true }, { admin: false }, {}, null]) {
    check(`a reason is given for ${JSON.stringify(body)}`, readAdminBody(body).because.length > 0)
  }
}

// A client stub. Only two things are read off it, and the probe imports the
// SDK for TYPES only (O-tp9), so this is the whole of what a check needs.
const stubClient = (over: { userId?: string | null; baseUrl?: string } = {}) =>
  ({
    getUserId: () => (over.userId === undefined ? '@saber:x.net' : over.userId),
    baseUrl: over.baseUrl ?? 'https://hs.example/',
  }) as unknown as Parameters<typeof observeServerAdmin>[0]

const stubToken = (token: string | null = 'tok') => ({
  get: () => token,
  refresh: async () => {},
})

const reply = (status: number, body: unknown = {}) =>
  (async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  })) as unknown as typeof fetch

async function main() {
  console.log('\n-- what each answer from the homeserver means --')
  {
    const yes = await observeServerAdmin(stubClient(), stubToken(), reply(200, { admin: true }))
    check('200 with admin true is admin', yes.verdict === 'admin')

    const no200 = await observeServerAdmin(stubClient(), stubToken(), reply(200, { admin: false }))
    check('200 with admin false is not-admin', no200.verdict === 'not-admin')

    // The clean no. Synapse answers 403 to a non-administrator, and that is an
    // ANSWER -- the only status here that is.
    const forbidden = await observeServerAdmin(stubClient(), stubToken(), reply(403))
    check('403 is a real no', forbidden.verdict === 'not-admin')

    // Not Synapse, or the admin API is not on this listener. Not a no.
    const missing = await observeServerAdmin(stubClient(), stubToken(), reply(404))
    check('404 is unknown, not a no', missing.verdict === 'unknown')
    const bad = await observeServerAdmin(stubClient(), stubToken(), reply(400))
    check('400 is unknown, not a no', bad.verdict === 'unknown')
    const boom = await observeServerAdmin(stubClient(), stubToken(), reply(500))
    check('500 is unknown, not a no', boom.verdict === 'unknown')
  }

  console.log('\n-- under delegated auth, the question goes to MAS --')
  {
    // Under MSC3861 Synapse does not register /users/<id>/admin at all (404,
    // measured live 2026-09-28) and would decide admin by the TOKEN's scope
    // anyway. The account's flag is at MAS. These stubs answer Synapse as it
    // does live -- 404 -- and MAS with the given body, and record who was asked.
    const ISSUER = 'https://auth.example/'
    let seen: string[] = []
    const both = (masStatus: number, masBody: unknown) => (async (url: string) => {
      seen.push(String(url))
      return String(url).startsWith(ISSUER)
        ? { status: masStatus, ok: masStatus >= 200 && masStatus < 300, json: async () => masBody }
        : { status: 404, ok: false, json: async () => ({ errcode: 'M_UNRECOGNIZED' }) }
    }) as unknown as typeof fetch
    const user = (canRequestAdmin: unknown) => ({ data: { viewer: { __typename: 'User', canRequestAdmin } } })

    const yes = await observeServerAdmin(stubClient(), stubToken(), both(200, user(true)), ISSUER)
    check('with an issuer, MAS canRequestAdmin true is admin', yes.verdict === 'admin', yes)
    check('and it asked MAS at <issuer>graphql', seen.includes('https://auth.example/graphql'), seen)
    check('and did not ask Synapse, which has no such endpoint there',
      !seen.some((u) => u.includes('/_synapse/')), seen)
    seen = []
    const no = await observeServerAdmin(stubClient(), stubToken(), both(200, user(false)), ISSUER)
    check('with an issuer, MAS canRequestAdmin false is not-admin', no.verdict === 'not-admin', no)
    const anon = await observeServerAdmin(stubClient(), stubToken(),
      both(200, { data: { viewer: { __typename: 'Anonymous' } } }), ISSUER)
    check('a token MAS answers as Anonymous is unknown, not a no', anon.verdict === 'unknown', anon)
    const masDown = await observeServerAdmin(stubClient(), stubToken(), both(502, {}), ISSUER)
    check('MAS failing is unknown, not a no', masDown.verdict === 'unknown', masDown)
    // No issuer: a server without delegated auth asks Synapse, as before --
    // here the 404 it gives under delegation, which is unknown.
    seen = []
    const plain = await observeServerAdmin(stubClient(), stubToken(), both(200, user(true)))
    check('without an issuer Synapse is asked and MAS is not',
      plain.verdict === 'unknown' && !seen.some((u) => u.startsWith(ISSUER)), { plain, seen })

    check('MAS body: canRequestAdmin true is admin', readMasAdminBody(user(true)).verdict === 'admin')
    check('MAS body: a string "true" is unknown', readMasAdminBody(user('true')).verdict === 'unknown')
    check('MAS body: missing field is unknown', readMasAdminBody({ data: { viewer: { __typename: 'User' } } }).verdict === 'unknown')
    check('MAS body: graphql errors are unknown', readMasAdminBody({ errors: [{ message: 'x' }] }).verdict === 'unknown')
    check('MAS body: null is unknown', readMasAdminBody(null).verdict === 'unknown')

    // The retry rule holds at MAS too: one refresh on 401, never a loop.
    let calls = 0
    let refreshed = 0
    const flakyMas = (async () => {
      calls++
      return calls === 1
        ? { status: 401, ok: false, json: async () => ({}) }
        : { status: 200, ok: true, json: async () => user(true) }
    }) as unknown as typeof fetch
    const r = await observeServerAdmin(stubClient(), { get: () => 'tok', refresh: async () => { refreshed++ } }, flakyMas, ISSUER)
    check('MAS: an expired token is refreshed once and retried', r.verdict === 'admin' && refreshed === 1 && calls === 2, { r, refreshed, calls })
  }

  console.log('\n-- an expired token is retried once, and only once --')
  {
    // MAS access tokens live five minutes and the SDK refreshes one only when
    // the HOMESERVER rejects it, so the first call after an idle spell is a
    // coin toss. masSessions.ts learned this live, with a 401 on every query.
    let calls = 0
    let refreshed = 0
    const source = { get: () => 'tok', refresh: async () => { refreshed++ } }
    const flaky = (async () => {
      calls++
      return calls === 1
        ? { status: 401, ok: false, json: async () => ({}) }
        : { status: 200, ok: true, json: async () => ({ admin: true }) }
    }) as unknown as typeof fetch
    const r = await observeServerAdmin(stubClient(), source, flaky)
    check('the retry succeeds', r.verdict === 'admin')
    check('the token was refreshed once', refreshed === 1, refreshed)
    check('and it was asked exactly twice', calls === 2, calls)

    let always = 0
    const dead = (async () => {
      always++
      return { status: 401, ok: false, json: async () => ({}) }
    }) as unknown as typeof fetch
    const r2 = await observeServerAdmin(stubClient(), { get: () => 'tok', refresh: async () => {} }, dead)
    check('a permanently rejected token is unknown, not a no', r2.verdict === 'unknown')
    check('and it does not loop', always === 2, always)
  }

  console.log('\n-- nothing to ask with --')
  {
    const noUser = await observeServerAdmin(stubClient({ userId: null }), stubToken(), reply(200, { admin: true }))
    check('no signed-in account is unknown', noUser.verdict === 'unknown')

    const noToken = await observeServerAdmin(stubClient(), stubToken(null), reply(200, { admin: true }))
    check('no access token is unknown', noToken.verdict === 'unknown')

    const offline = (async () => { throw new Error('network down') }) as unknown as typeof fetch
    const down = await observeServerAdmin(stubClient(), stubToken(), offline)
    check('an unreachable homeserver is unknown', down.verdict === 'unknown')
    check('and says so in words', down.because.toLowerCase().includes('reach'))

    const garbage = (async () => ({
      status: 200,
      ok: true,
      json: async () => { throw new Error('not json') },
    })) as unknown as typeof fetch
    const junk = await observeServerAdmin(stubClient(), stubToken(), garbage)
    check('an answer that is not an answer is unknown', junk.verdict === 'unknown')
  }

  console.log('\n-- the URL it asks --')
  {
    let seen = ''
    const spy = (async (url: string) => {
      seen = String(url)
      return { status: 200, ok: true, json: async () => ({ admin: true }) }
    }) as unknown as typeof fetch
    await observeServerAdmin(stubClient({ baseUrl: 'https://hs.example' }), stubToken(), spy)
    check('a base URL with no trailing slash still lands on the admin path',
      seen === 'https://hs.example/_synapse/admin/v1/users/%40saber%3Ax.net/admin', seen)

    await observeServerAdmin(stubClient({ baseUrl: 'https://hs.example/' }), stubToken(), spy)
    check('and one with a trailing slash lands in the same place',
      seen === 'https://hs.example/_synapse/admin/v1/users/%40saber%3Ax.net/admin', seen)
  }

  if (failures > 0) {
    console.log(`\n${failures} FAILED`)
    process.exit(1)
  }
  console.log('\nALL CHECKS PASSED')
}

void main()
