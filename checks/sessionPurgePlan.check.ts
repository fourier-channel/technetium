// Checks for sessionPurgePlan and the scope/session plumbing around it.
//
// The invariant with teeth: THIS session is never in a purge list. The rest
// pins the join between MAS's sessions and crypto's verified devices, the
// device id parsed out of an OAuth scope, and -- as a source guard -- that
// login requests the GraphQL scope through our own URL builder, since the
// SDK's cannot be asked for it and a quiet revert would make the Sessions
// section report every login as 'no-scope' forever.
import { readFileSync } from 'node:fs'
import { purgePlan, describeSessions, type PurgeableSession } from '../src/client/sessionPurgePlan.ts'
import { deviceIdFromScope } from '../src/client/masSessions.ts'
import { loginScope, hasGraphqlScope, MAS_GRAPHQL_SCOPE } from '../src/client/oidcAuthorize.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const s = (id: string, deviceId: string | null, kind: 'compat' | 'oauth' = 'oauth'): PurgeableSession =>
  ({ id, kind, deviceId, label: 'Technetium', lastActiveAt: null })

const me = 'MEMEMEMEME'
const list = [s('1', me), s('2', 'VERIFIED01'), s('3', 'UNVER00001'), s('4', null), s('5', 'VERIFIED02', 'compat')]
const plan = purgePlan(list, me, new Set(['VERIFIED01', 'VERIFIED02']))

check('this session is never among the others', !plan.others.some((x) => x.deviceId === me))
check('this session is never among the unverified', !plan.unverified.some((x) => x.deviceId === me))
check('others = everything but this session', plan.others.map((x) => x.id).join() === '2,3,4,5')
check('unverified = others minus verified devices', plan.unverified.map((x) => x.id).join() === '3,4')
check('a session with no device id counts as unverified', plan.unverified.some((x) => x.id === '4'))
check('unknown own device id excludes nothing', purgePlan(list, null, new Set()).others.length === 5)
check('nothing verified: unverified is all the others', purgePlan(list, me, new Set()).unverified.length === 4)

const many = Array.from({ length: 20 }, (_, i) => s(String(i), 'DEV' + i))
const lines = describeSessions(many, 12)
check('long lists are cut with an honest remainder', lines.length === 13 && lines[12] === 'and 8 more')
check('short lists are whole', describeSessions(many.slice(0, 3)).length === 3)

check('device id parsed from an OAuth scope',
  deviceIdFromScope('openid urn:matrix:org.matrix.msc2967.client:api:* urn:matrix:org.matrix.msc2967.client:device:ABCDEF1234 urn:mas:graphql:*') === 'ABCDEF1234')
check('no device scope: null', deviceIdFromScope('openid urn:mas:graphql:*') === null)

check('login scope carries the GraphQL scope', hasGraphqlScope(loginScope()) && loginScope().includes(MAS_GRAPHQL_SCOPE))
check('login scope still carries openid and the client api', /\bopenid\b/.test(loginScope()) && loginScope().includes('urn:matrix:org.matrix.msc2967.client:api:*'))
check('a pre-change token has no scope', !hasGraphqlScope('openid urn:matrix:org.matrix.msc2967.client:api:*') && !hasGraphqlScope(undefined))

const ctx = readFileSync(new URL('../src/client/ClientContext.tsx', import.meta.url), 'utf8')
check('login builds its URL through oidcAuthorize, not the SDK', /generateLoginUrl\(/.test(ctx) && !/generateOidcAuthorizationUrl\(/.test(ctx))

if (failures > 0) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nall sessionPurgePlan checks passed')
