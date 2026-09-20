// Which existing DM may be reopened, and which must not be.
//
// The gap this closes, reported from the running client: removing the other
// person from a DM left that room as the permanent answer for "a DM with
// them". Starting a new conversation reopened the dead one, and re-inviting
// them preferred a window with nobody in it, with no way out short of editing
// account data by hand.
//
// findExistingDm checked MY membership while its own comment said reusing a
// room "the user has left" would be wrong -- and the user it checked was me.
// A one-sided test for a two-sided fact.
import { findExistingDm, directRoomIds } from '../src/client/dm.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const THEM = '@neru:41chan.net'
const ME = '@saber:41chan.net'

// The smallest client this function actually touches: account data and rooms.
function clientWith(
  direct: Record<string, string[]>,
  rooms: Record<string, { mine: string; theirs?: string }>,
) {
  return {
    getAccountData: () => ({ getContent: () => direct }),
    getUserId: () => ME,
    getRoom: (id: string) => {
      const r = rooms[id]
      if (!r) return null
      return {
        getMyMembership: () => r.mine,
        getMember: (u: string) => (u === THEM && r.theirs ? { membership: r.theirs } : null),
      }
    },
  } as never
}

console.log('== a DM both of us are in is reused')
check('joined on both sides',
  findExistingDm(clientWith({ [THEM]: ['!a:x'] }, { '!a:x': { mine: 'join', theirs: 'join' } }), THEM) === '!a:x')

console.log('== a DM the other person is no longer in is NOT reused')
for (const theirs of ['leave', 'ban']) {
  check(`they are "${theirs}" -- a fresh room is needed`,
    findExistingDm(clientWith({ [THEM]: ['!dead:x'] }, { '!dead:x': { mine: 'join', theirs } }), THEM) === null)
}
check('they have no member event at all',
  findExistingDm(clientWith({ [THEM]: ['!dead:x'] }, { '!dead:x': { mine: 'join' } }), THEM) === null)

console.log('== a pending invite still counts as this conversation')
// Otherwise reaching for someone slow to answer spawns a new room every time.
check('they are invited but have not accepted',
  findExistingDm(clientWith({ [THEM]: ['!pending:x'] }, { '!pending:x': { mine: 'join', theirs: 'invite' } }), THEM) === '!pending:x')

console.log('== my own membership still matters')
for (const mine of ['leave', 'invite']) {
  check(`I am "${mine}" -- not reusable`,
    findExistingDm(clientWith({ [THEM]: ['!x:x'] }, { '!x:x': { mine, theirs: 'join' } }), THEM) === null)
}

console.log('== the first LIVE room wins, not the first listed')
// m.direct keeps dead rooms in the order they were made, so the live one is
// usually last. Returning the first entry is how this bug looked correct.
check('a dead room earlier in the list is skipped',
  findExistingDm(
    clientWith({ [THEM]: ['!dead:x', '!live:x'] },
      { '!dead:x': { mine: 'join', theirs: 'leave' }, '!live:x': { mine: 'join', theirs: 'join' } }),
    THEM) === '!live:x')

console.log('== unknown rooms and empty maps are null, not a crash')
check('a room the client has never seen', findExistingDm(clientWith({ [THEM]: ['!gone:x'] }, {}), THEM) === null)
check('no entry for this user', findExistingDm(clientWith({}, {}), THEM) === null)

console.log('== PRESENTATION is deliberately not membership-filtered')
// directRoomIds decides how a room is DRAWN -- as a person rather than a room
// -- and a dead entry costs nothing there. Only reuse needs the stricter test.
check('a dead DM is still known to be a DM',
  directRoomIds(clientWith({ [THEM]: ['!dead:x'] }, { '!dead:x': { mine: 'join', theirs: 'leave' } })).has('!dead:x'))

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\ndm reuse: all checks passed')
