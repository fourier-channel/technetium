// Checks for carousel geometry.
//
// The premise is that the results come to the reader rather than the reader
// going to the results, so the only state is "where is the focus" and this is
// the only arithmetic. Getting it wrong does not throw -- it just puts the card
// somewhere other than under the reader's eyes, which is the whole feature.
import {
  cardCentre,
  stepFocus,
  trackOffset,
  visualDistance,
  MAX_VISUAL_DISTANCE,
} from '../src/ui/carousel.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const M = { cardWidth: 200, gap: 12, viewportWidth: 1000, count: 10 }

console.log('\n-- the focused card lands under the middle --')
{
  // The defining property: whatever is focused ends up centred. If this holds
  // for every index, the carousel is correct.
  let allCentred = true
  for (let i = 0; i < M.count; i++) {
    const offset = trackOffset(i, M)
    const centreOnScreen = offset + cardCentre(i, M.cardWidth, M.gap)
    if (Math.abs(centreOnScreen - M.viewportWidth / 2) > 0.001) allCentred = false
  }
  check('every card centres when focused', allCentred)

  check('the first card centres too', Math.abs(trackOffset(0, M) - (500 - 100)) < 0.001,
    trackOffset(0, M))

  // Not clamped at the ends, on purpose: a carousel that refuses to centre its
  // first and last cards leaves them off-centre while every other card is
  // centred, which reads as broken edges.
  check('the ends are not clamped away from centre',
    trackOffset(M.count - 1, M) < trackOffset(M.count - 2, M))
}

console.log('\n-- moving through it --')
{
  check('stepping forward advances one', stepFocus(3, 1, 10) === 4)
  check('stepping back retreats one', stepFocus(3, -1, 10) === 2)
  check('a bigger jump is honoured', stepFocus(3, 4, 10) === 7)

  // Stops rather than wraps: in a list sorted by recency, wrapping would jump
  // from the newest thread to the oldest on one keypress.
  check('it stops at the start, not wraps', stepFocus(0, -1, 10) === 0)
  check('it stops at the end, not wraps', stepFocus(9, 1, 10) === 9)
  check('an overshoot lands on the end', stepFocus(5, 99, 10) === 9)
  check('an undershoot lands on the start', stepFocus(5, -99, 10) === 0)
}

console.log('\n-- degenerate cases --')
{
  // An empty list must not produce NaN and poison the transform: a NaN in a
  // CSS translate silently drops the whole rule and the track vanishes.
  const empty = { ...M, count: 0 }
  check('an empty carousel offsets by zero', trackOffset(0, empty) === 0)
  check('an empty carousel has no focus to step', stepFocus(0, 1, 0) === 0)
  check('a single card still centres',
    Math.abs(trackOffset(0, { ...M, count: 1 }) - (500 - 100)) < 0.001)

  // A focus left over from a longer list must not fly the track off-screen.
  check('a stale focus past the end is pulled back',
    trackOffset(50, { ...M, count: 3 }) === trackOffset(2, { ...M, count: 3 }))
  check('a negative focus is pulled back', trackOffset(-5, M) === trackOffset(0, M))

  check('every offset is finite',
    [0, 1, 9, -5, 50].every((i) => Number.isFinite(trackOffset(i, M))))
}

console.log('\n-- distance, for styling --')
{
  check('the focused card is at zero', visualDistance(4, 4) === 0)
  check('a neighbour is at one', visualDistance(5, 4) === 1 && visualDistance(3, 4) === 1)
  // Capped: six away and sixty away are both simply "not near", and should not
  // generate sixty different visual states.
  check('distance is capped', visualDistance(90, 4) === MAX_VISUAL_DISTANCE)
  check('the cap is symmetric', visualDistance(0, 90) === MAX_VISUAL_DISTANCE)
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
