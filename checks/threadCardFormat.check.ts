// Checks for the thread card's two formats.
//
// Both exist so a COLUMN of cards is comparable at a glance, which means the
// interesting cases are the ones that change a string's WIDTH or its meaning:
// a missing timestamp, a clock running backwards, a boundary between units.
import {
  LIVE_WINDOW_MS,
  formatCardWhen,
  formatDuration,
  isRecent,
} from '../src/ui/threadCardFormat.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

console.log('\n-- durations --')
{
  check('seconds under a minute', formatDuration(42_000) === '42s')
  check('minutes under an hour', formatDuration(12 * MIN) === '12m')
  check('hours and minutes', formatDuration(4 * HOUR + 25 * MIN) === '4h 25m')
  check('days and hours', formatDuration(3 * DAY + 4 * HOUR) === '3d 4h')

  // At most two units, largest first. "3d 4h 17m 9s" at 10px is noise, and the
  // card has room for a glance rather than an interval.
  check('never three units', formatDuration(3 * DAY + 4 * HOUR + 17 * MIN).split(' ').length <= 2)

  // A whole unit drops the empty remainder rather than printing "4h 0m".
  check('a whole hour has no minutes', formatDuration(4 * HOUR) === '4h')
  check('a whole day has no hours', formatDuration(2 * DAY) === '2d')

  // Boundaries, where an off-by-one changes the unit.
  check('59 seconds is seconds', formatDuration(59_000) === '59s')
  check('60 seconds is a minute', formatDuration(MIN) === '1m')
  check('59 minutes is minutes', formatDuration(59 * MIN) === '59m')
  check('60 minutes is an hour', formatDuration(HOUR) === '1h')
  check('23 hours is hours', formatDuration(23 * HOUR).startsWith('23h'))
  check('24 hours is a day', formatDuration(DAY) === '1d')

  // Nothing to show must not become "NaN" on the card.
  check('zero is zero seconds', formatDuration(0) === '0s')
  check('undefined is a dash', formatDuration(undefined) === '--')
  check('null is a dash', formatDuration(null) === '--')
  check('NaN is a dash', formatDuration(Number.NaN) === '--')
  // A clock that disagrees produces a negative age; a card must not print
  // "-3h" as though the future had already happened.
  check('a negative duration is a dash', formatDuration(-5000) === '--')
}

console.log('\n-- absolute times --')
{
  const when = formatCardWhen(Date.UTC(2026, 7, 22, 14, 51))
  check('a real timestamp formats to something', when.length > 0 && when !== '--', when)
  check('it carries no year', !/20\d\d/.test(when), when)
  // The columns line up only if every card's string is the same shape.
  const a = formatCardWhen(Date.UTC(2026, 7, 22, 14, 51))
  const b = formatCardWhen(Date.UTC(2026, 11, 1, 9, 5))
  check('two timestamps are the same width', a.length === b.length, [a, b])

  check('a missing timestamp is a dash', formatCardWhen(undefined) === '--')
  check('zero is a dash, not 1970', formatCardWhen(0) === '--')
  check('NaN is a dash', formatCardWhen(Number.NaN) === '--')
}

console.log('\n-- still happening? --')
{
  const now = 1_800_000_000_000
  check('a post a minute ago is recent', isRecent(now - MIN, now))
  check('a post 23 hours ago is recent', isRecent(now - 23 * HOUR, now))
  check('a post a day ago is not', !isRecent(now - LIVE_WINDOW_MS, now))
  check('a post a week ago is not', !isRecent(now - 7 * DAY, now))
  check('no timestamp is not recent', !isRecent(undefined, now) && !isRecent(0, now))

  // A future timestamp is a clock disagreeing, not maximum liveness. Treating
  // it as recent would let one skewed sender light up every card they touch.
  check('a future post is not "very recent"', !isRecent(now + HOUR, now))
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
