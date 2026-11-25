// Checks for which rooms earn a chime (tc.91).
//
// A chime that does not sound is noticed by nobody, and one that sounds wrongly
// is noticed by everybody, so both directions are here: each rule has a case
// that must ring and the nearest case that must not.
import { decideChimes, loudestChime, roomsLookedAt, type Chime } from '../src/client/notificationChimeDecision.ts'
import type { NotifMap } from '../src/client/notificationCounts.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const counts = (rooms: Record<string, [total: number, highlight: number]>): NotifMap =>
  new Map(Object.entries(rooms).map(([id, [total, highlight]]) => [id, { total, highlight }]))
const say = (cs: Chime[]) => cs.map((c) => `${c.roomId}:${c.kind}`).join(' ')
const run = (
  prev: NotifMap | null,
  next: NotifMap,
  { muted = [] as string[], looking = [] as string[] } = {},
) => say(decideChimes(prev, next, { isMutedNow: (id) => muted.includes(id), lookingAt: new Set(looking) }))
const is = (name: string, got: string, want: string) => check(name, got === want, { got, want })

console.log('\n-- what rings --')
is('nothing unread -> something: unread', run(counts({}), counts({ a: [1, 0] })), 'a:unread')
is('a held zero counts as nothing', run(counts({ a: [0, 0] }), counts({ a: [1, 0] })), 'a:unread')
is('read, then unread again rings again', run(counts({ b: [1, 0] }), counts({ a: [2, 0], b: [1, 0] })), 'a:unread')
is('a mention in a quiet room is a highlight, once', run(counts({}), counts({ a: [1, 1] })), 'a:highlight')
is('a mention in a room already waiting', run(counts({ a: [4, 0] }), counts({ a: [5, 1] })), 'a:highlight')
is('every further mention', run(counts({ a: [5, 1] }), counts({ a: [6, 2] })), 'a:highlight')
is('several rooms in one change', run(counts({ c: [1, 0] }), counts({ a: [1, 0], b: [1, 1], c: [2, 0] })), 'a:unread b:highlight')

console.log('\n-- what does not --')
is('a room already waiting gets more messages', run(counts({ a: [1, 0] }), counts({ a: [9, 0] })), '')
is('the same counts again', run(counts({ a: [2, 1] }), counts({ a: [2, 1] })), '')
is('a mention read elsewhere (falls)', run(counts({ a: [5, 2] }), counts({ a: [5, 1] })), '')
is('a room read (falls)', run(counts({ a: [5, 0] }), counts({ a: [1, 0] })), '')
is('a room leaving the map', run(counts({ a: [5, 2] }), counts({})), '')
is('the first answer is a baseline', run(null, counts({ a: [5, 2], b: [1, 0] })), '')
{
  const m = counts({ a: [1, 1] })
  is('the same map', run(m, m), '')
}

console.log('\n-- muted and looked-at rooms, for both kinds --')
for (const [kind, next] of [['unread', counts({ a: [1, 0] })], ['highlight', counts({ a: [1, 1] })]] as const) {
  is(`${kind}: a muted room is silent`, run(counts({}), next, { muted: ['a'] }), '')
  is(`${kind}: a room on screen is silent`, run(counts({}), next, { looking: ['a'] }), '')
  is(`${kind}: muting another room changes nothing`, run(counts({}), next, { muted: ['b'] }), `a:${kind}`)
  is(`${kind}: looking at another room changes nothing`, run(counts({}), next, { looking: ['b'] }), `a:${kind}`)
}
is('a muted room does not silence its neighbour', run(counts({}), counts({ a: [1, 1], b: [1, 0] }), { muted: ['a'] }), 'b:unread')
is('a mute that lifts does not ring for what it hid', run(counts({ a: [3, 1] }), counts({ a: [3, 1], z: [0, 0] })), '')

console.log('\n-- roomsLookedAt --')
const see = (...a: Parameters<typeof roomsLookedAt>) => [...roomsLookedAt(...a)].sort().join(' ')
is('the selected room', see(true, 'a', null, false), 'a')
is('the selected room and the open dock', see(true, 'a', 'd', true), 'a d')
is('a closed dock is not looked at', see(true, 'a', 'd', false), 'a')
is('a dock with no room selected', see(true, null, 'd', true), 'd')
is('a hidden tab is looking at nothing', see(false, 'a', 'd', true), '')
is('nothing open', see(true, null, null, true), '')

console.log('\n-- loudestChime --')
check('none -> silent', loudestChime([]) === null)
check('unreads -> unread', loudestChime([{ roomId: 'a', kind: 'unread' }]) === 'unread')
check(
  'a mention outranks an unread wherever it falls',
  loudestChime([{ roomId: 'a', kind: 'unread' }, { roomId: 'b', kind: 'highlight' }]) === 'highlight' &&
    loudestChime([{ roomId: 'b', kind: 'highlight' }, { roomId: 'a', kind: 'unread' }]) === 'highlight',
)

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
