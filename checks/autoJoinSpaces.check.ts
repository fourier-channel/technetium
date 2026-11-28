// Checks for the sub-spaces every member is joined to (tc.84; Developer,
// 2026-11-28: five sub-spaces, no opting out; the two invite-only ones never
// appear for anyone not invited).
//
// WHAT THIS CANNOT SEE: a real homeserver's answer to the joins, or the
// hierarchy it returns to a person who is not invited. It proves the decision
// over fake memberships, and that the table holds only ids.
import { readFileSync } from 'node:fs'
import {
  AUTO_JOIN_SPACES,
  HUB_SPACE_ID,
  joinFailureText,
  spacesToJoin,
  validRoomId,
  type AutoJoinSpace,
} from '../src/client/autoJoinSpaces.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const T: AutoJoinSpace[] = [
  { name: 'a', id: '!aaaa:41chan.net' },
  { name: 'b', id: '!bbbb:41chan.net' },
  { name: 'c', id: '!cccc:41chan.net' },
]
const ids = (xs: AutoJoinSpace[]) => xs.map((s) => s.id).join(',')
const mem = (m: Record<string, string>) => (id: string) => m[id]

// --- the hub gates everything ---
check('outside the hub, nothing is joined', spacesToJoin(mem({}), T).length === 0)
check('invited to the hub but not in it, nothing is joined',
  spacesToJoin(mem({ [HUB_SPACE_ID]: 'invite' }), T).length === 0)
check('left the hub, nothing is joined',
  spacesToJoin(mem({ [HUB_SPACE_ID]: 'leave' }), T).length === 0)
check('in the hub with none joined, every space in table order',
  ids(spacesToJoin(mem({ [HUB_SPACE_ID]: 'join' }), T)) === ids(T))

// --- per space ---
check('a joined space is not joined again',
  ids(spacesToJoin(mem({ [HUB_SPACE_ID]: 'join', '!bbbb:41chan.net': 'join' }), T)) === '!aaaa:41chan.net,!cccc:41chan.net')
check('a left space is joined again (no opting out)',
  ids(spacesToJoin(mem({ [HUB_SPACE_ID]: 'join', '!aaaa:41chan.net': 'leave', '!bbbb:41chan.net': 'join', '!cccc:41chan.net': 'join' }), T)) === '!aaaa:41chan.net')
check('an invite to a space is accepted by joining it',
  ids(spacesToJoin(mem({ [HUB_SPACE_ID]: 'join', '!aaaa:41chan.net': 'invite', '!bbbb:41chan.net': 'join', '!cccc:41chan.net': 'join' }), T)) === '!aaaa:41chan.net')
check('a banned space is left alone',
  ids(spacesToJoin(mem({ [HUB_SPACE_ID]: 'join', '!aaaa:41chan.net': 'ban' }), T)) === '!bbbb:41chan.net,!cccc:41chan.net')
check('all joined, nothing to do',
  spacesToJoin(mem({ [HUB_SPACE_ID]: 'join', '!aaaa:41chan.net': 'join', '!bbbb:41chan.net': 'join', '!cccc:41chan.net': 'join' }), T).length === 0)

// --- a bad table cannot make it join the wrong thing ---
check('a name in place of an id is skipped, never resolved',
  spacesToJoin(mem({ [HUB_SPACE_ID]: 'join' }), [{ name: 'x', id: 'chanviewru' }, { name: 'y', id: '#alias:41chan.net' }]).length === 0)
check('the hub in the table is skipped',
  spacesToJoin(mem({ [HUB_SPACE_ID]: 'join' }), [{ name: 'hub', id: HUB_SPACE_ID }]).length === 0)
check('a repeated id is joined once',
  ids(spacesToJoin(mem({ [HUB_SPACE_ID]: 'join' }), [T[0], T[0]])) === '!aaaa:41chan.net')
check('validRoomId takes a room id and refuses alias, name, empty and junk',
  validRoomId('!vlnhcHMGIlolgTsmsk:41chan.net') && !validRoomId('#x:41chan.net') && !validRoomId('chanviewru') &&
  !validRoomId('') && !validRoomId(null) && !validRoomId('!a b:41chan.net') && !validRoomId('!' + 'a'.repeat(300) + ':x'))

// --- the shipped table ---
check('the hub id is the 41chan space', HUB_SPACE_ID === '!jeEGyrShDSyjWSBXJo:41chan.net')
check('every shipped entry is a room id on this server, no repeats, not the hub',
  AUTO_JOIN_SPACES.every((s) => validRoomId(s.id) && s.id.endsWith(':41chan.net') && s.id !== HUB_SPACE_ID) &&
  new Set(AUTO_JOIN_SPACES.map((s) => s.id)).size === AUTO_JOIN_SPACES.length)
check('the shipped table is exactly the five ruled 2026-11-28',
  AUTO_JOIN_SPACES.map((s) => s.id).sort().join(',') === [
    '!vlnhcHMGIlolgTsmsk:41chan.net', '!bHuJtptdgyDTeRnjRM:41chan.net', '!xvtWVeKOoTkqSevjsU:41chan.net',
    '!UkoaWcdzvGVqYylxtn:41chan.net', '!JTbiQKasQYFLtfcEUC:41chan.net',
  ].sort().join(','), AUTO_JOIN_SPACES)
check('in the hub with none joined, the shipped table joins all five',
  spacesToJoin(mem({ [HUB_SPACE_ID]: 'join' })).length === 5)

// --- the report ---
const f = joinFailureText(T[0], 'HTTP 403 M_FORBIDDEN')
check('a failed join names the space, the id, the cause and the fix',
  f.includes('a sub-space') && f.includes('!aaaa:41chan.net') && f.includes('M_FORBIDDEN') && f.includes('join rule'))

// --- wiring ---
const watch = readFileSync(new URL('../src/client/autoJoinSpacesWatch.ts', import.meta.url), 'utf8')
const ctx = readFileSync(new URL('../src/client/ClientContext.tsx', import.meta.url), 'utf8')
check('the watcher joins only what spacesToJoin decides',
  /for \(const space of spacesToJoin\(membership\)\)/.test(watch) && (watch.match(/joinRoom\(/g) ?? []).length === 1)
check('the watcher reacts to the first sync and to joining the hub',
  /state === 'PREPARED'/.test(watch) && /room\.roomId === HUB_SPACE_ID && m === 'join'/.test(watch))
check('a failed join is reported every time, never swallowed',
  /catch \(err\) \{[\s\S]*?reportAlways\('auto-join sub-spaces', joinFailureText\(space, detail\(err\)\)\)/.test(watch))
check('the client installs the watcher before it starts syncing',
  /watchAutoJoinSpaces\(c\)\n\s*setClient\(c\)\n\s*await startAndWaitForSync\(c\)/.test(ctx))

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
