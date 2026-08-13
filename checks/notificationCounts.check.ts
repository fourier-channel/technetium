// Checks for the G-tp23 notification-count parse and comparison.
//
// The parse is the half that decides what the room list believes, so the cases
// that matter are the malformed ones: the bug this replaces was a real, typed,
// well-formed ZERO that nothing questioned.
import {
  COUNTS_FILTER,
  MIN_POLL_GAP_MS,
  POLL_SETTLE_MS,
  nextPollDelay,
  parseNotificationCounts,
  sameCounts,
  type NotifMap,
} from '../src/client/notificationCounts.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const res = (join: Record<string, unknown>) => ({ rooms: { join } })
const un = (notification_count?: unknown, highlight_count?: unknown) => ({
  unread_notifications: { notification_count, highlight_count },
})

console.log('\n-- COUNTS_FILTER --')
{
  const f = JSON.parse(COUNTS_FILTER)
  // The shape proven against the live homeserver. If someone trims it, these
  // fail and the comment telling them to re-verify is right above it.
  check('excludes presence', Array.isArray(f.presence?.types) && f.presence.types.length === 0)
  check('excludes room state', Array.isArray(f.room?.state?.types) && f.room.state.types.length === 0)
  check('excludes ephemeral', Array.isArray(f.room?.ephemeral?.types) && f.room.ephemeral.types.length === 0)
  check('keeps the proven timeline limit of 1', f.room?.timeline?.limit === 1)
}

console.log('\n-- parseNotificationCounts --')
{
  const m = parseNotificationCounts(res({ '!a:x.net': un(5, 0), '!b:x.net': un(2, 2) }))
  check('reads a total', m.get('!a:x.net')?.total === 5)
  check('reads a highlight', m.get('!b:x.net')?.highlight === 2)
  check('keeps both rooms', m.size === 2)
}
{
  // Absent and zero are the same thing to every consumer, so a zero room is
  // simply not carried -- 40 zero entries would make every comparison and
  // re-render pointless work.
  const m = parseNotificationCounts(res({ '!z:x.net': un(0, 0), '!a:x.net': un(1, 0) }))
  check('a fully zero room is omitted', !m.has('!z:x.net'))
  check('a non-zero room survives alongside it', m.get('!a:x.net')?.total === 1)
}
{
  const m = parseNotificationCounts(res({ '!a:x.net': un(0, 3) }))
  check('highlight alone is enough to carry the room', m.get('!a:x.net')?.highlight === 3)
  check('its total stays 0', m.get('!a:x.net')?.total === 0)
}

console.log('\n-- parseNotificationCounts: malformed input --')
{
  check('undefined response', parseNotificationCounts(undefined).size === 0)
  check('null response', parseNotificationCounts(null).size === 0)
  check('a response with no rooms', parseNotificationCounts({}).size === 0)
  check('a response with no join section', parseNotificationCounts({ rooms: {} }).size === 0)
  check('a room with no unread_notifications', parseNotificationCounts(res({ '!a:x.net': {} })).size === 0)
}
{
  // Server-supplied numbers. A string or a NaN must read as "no unread", never
  // coerce into a badge that renders NaN.
  const m = parseNotificationCounts(res({ '!a:x.net': un('5', '2'), '!b:x.net': un(NaN, NaN) }))
  check('a string count is not coerced', !m.has('!a:x.net'))
  check('NaN is not carried', !m.has('!b:x.net'))
}
{
  const m = parseNotificationCounts(res({ '!a:x.net': un(-3, -1) }))
  check('a negative count is treated as absent', !m.has('!a:x.net'))
}
{
  const m = parseNotificationCounts(res({ '!a:x.net': un(2.7, 0) }))
  check('a fractional count floors rather than rendering 2.7', m.get('!a:x.net')?.total === 2)
}

console.log('\n-- sameCounts --')
{
  const a: NotifMap = new Map([['!a', { total: 1, highlight: 0 }]])
  const b: NotifMap = new Map([['!a', { total: 1, highlight: 0 }]])
  check('equal maps compare equal', sameCounts(a, b))
  check('identity is equal', sameCounts(a, a))
  check('empty maps compare equal', sameCounts(new Map(), new Map()))
}
{
  const a: NotifMap = new Map([['!a', { total: 1, highlight: 0 }]])
  check('a differing total is not equal', !sameCounts(a, new Map([['!a', { total: 2, highlight: 0 }]])))
  check('a differing highlight is not equal', !sameCounts(a, new Map([['!a', { total: 1, highlight: 1 }]])))
  check('a differing room id is not equal', !sameCounts(a, new Map([['!b', { total: 1, highlight: 0 }]])))
  check('a different size is not equal', !sameCounts(a, new Map()))
  // The case that would strand a stale badge on screen: same size, same keys,
  // one room swapped for another is caught by the key lookup above; this one
  // guards the reverse direction.
  check('extra entries are not equal', !sameCounts(new Map(), a))
}

console.log('\n-- nextPollDelay: cannot be starved --')
{
  // THE REGRESSION. ClientEvent.Sync fires on every sliding-sync long-poll
  // cycle, several times a second in a busy room. The previous implementation
  // cleared and re-armed its timer on each one, so the deadline outran the
  // clock and counts only updated once traffic went quiet. Simulate that burst:
  // once a poll is armed, no amount of further activity may move it.
  let armed = false
  const t0 = 1_000_000
  const first = nextPollDelay(t0, t0 - 60_000, armed)
  check('the first event of a burst arms a poll', first === POLL_SETTLE_MS, first)
  armed = true
  let starved = false
  for (let i = 1; i <= 200; i++) {
    // An event every 15ms for three seconds -- far denser than any real room.
    if (nextPollDelay(t0 + i * 15, t0 - 60_000, armed) !== null) starved = true
  }
  check('200 further events cannot re-arm or postpone it', !starved)
  check('once it lands, the next event can arm again', nextPollDelay(t0 + 3000, t0 + 1500, false) !== null)
}

console.log('\n-- nextPollDelay: rate floor --')
{
  const t = 1_000_000
  check(
    'idle for a long time -> settle delay only',
    nextPollDelay(t, t - 60_000, false) === POLL_SETTLE_MS,
  )
  check(
    'never polled -> settle delay only',
    nextPollDelay(t, 0, false) === POLL_SETTLE_MS,
  )
  // Straight after a poll, the floor dominates so a busy room cannot issue a
  // filtered full sync every 1.5s.
  check(
    'just polled -> waits out the gap floor',
    nextPollDelay(t, t, false) === MIN_POLL_GAP_MS,
  )
  check(
    'part way through the gap -> the remainder',
    nextPollDelay(t, t - 3_000, false) === MIN_POLL_GAP_MS - 3_000,
  )
  check(
    'the returned delay is never below the settle delay',
    nextPollDelay(t, t - (MIN_POLL_GAP_MS - 100), false) === POLL_SETTLE_MS,
  )
  check('the gap floor is above the settle delay', MIN_POLL_GAP_MS > POLL_SETTLE_MS)
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
