// Checks for the bubble animators' data (ui-depth-v1 U5).
//
// The shapes are CSS and cannot be loaded here. What CAN be held is the part
// that decides how long a row keeps something mounted and where the question
// marks go -- and the first of those is load-bearing: the hook unmounts the
// marks on a TIMER built from fxDurationMs, never on animationend (G-tc06), so
// a duration shorter than the animation would cut them off mid-flight and one
// longer would leave invisible elements on every questioning row in the log.
import {
  QMARK_COUNT,
  QMARK_MS,
  QMARK_STAGGER_MS,
  MORPH_MS,
  PILL_MS,
  fxDurationMs,
  qmarks,
  toneAnimates,
} from '../src/client/bubbleFx.ts'

let failures = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

console.log('\n-- which tones do anything --')
{
  check('yelling animates', toneAnimates('yelling'))
  check('thinking animates', toneAnimates('thinking'))
  check('questioning animates', toneAnimates('questioning'))
  // If every message animated, none of them would mean anything.
  check('a plain message does not', !toneAnimates('standard'))
}

console.log('\n-- how long the performance lasts --')
{
  // The one that matters: the LAST mark has to finish before the hook takes
  // them away. A duration that only covers the first would cut the rest off
  // mid-flight, and the bug would only show on rows with several marks.
  const lastMarkEnds = QMARK_STAGGER_MS * (QMARK_COUNT - 1) + QMARK_MS
  check('the questioning window outlasts the last mark',
    fxDurationMs('questioning') >= lastMarkEnds,
    { window: fxDurationMs('questioning'), lastMarkEnds })

  check('the pop lasts as long as the pop', fxDurationMs('yelling') === MORPH_MS)
  check('the morph lasts as long as the morph', fxDurationMs('thinking') === MORPH_MS)
  check('a plain message has no window', fxDurationMs('standard') === 0)

  // The pill has to be visible as a pill -- "render the default pill first" --
  // and not so long that the row reads as stalled.
  check('the pill beat is long enough to see', PILL_MS >= 120)
  check('and short enough not to read as a stall', PILL_MS <= 400)
}

console.log('\n-- the marks are seeded, not random --')
{
  const a = qmarks('$ev:1')
  const b = qmarks('$ev:1')
  check('the same message always gets the same marks',
    JSON.stringify(a) === JSON.stringify(b))

  const c = qmarks('$ev:2')
  check('a different message gets different marks',
    JSON.stringify(a) !== JSON.stringify(c))

  check('an empty seed does not throw and still produces marks', qmarks('').length === QMARK_COUNT)
}

console.log('\n-- the marks stay on the bubble --')
{
  // Every seed, not one: a mark spawning at 0% straddles the bubble's border,
  // which reads as a rendering fault rather than as a question.
  let offEdge = 0
  let tooSmall = 0
  let noRise = 0
  let outOfOrder = 0
  for (let i = 0; i < 400; i++) {
    const ms = qmarks(`seed-${i}`)
    if (ms.length !== QMARK_COUNT) { offEdge++; continue }
    let lastDelay = -1
    for (const m of ms) {
      if (m.xPct < 5 || m.xPct > 95) offEdge++
      if (m.sizePx < 9 || m.sizePx > 20) tooSmall++
      if (m.risePx <= 0) noRise++
      if (m.delayMs <= lastDelay) outOfOrder++
      lastDelay = m.delayMs
    }
  }
  check('no mark spawns on the bubble\'s edge', offEdge === 0, offEdge)
  check('every mark is a readable size', tooSmall === 0, tooSmall)
  check('every mark rises -- none sinks or hangs', noRise === 0, noRise)
  check('the marks spawn in order, one after another', outOfOrder === 0, outOfOrder)
}

console.log('\n-- the marks differ from each other within a row --')
{
  // Four marks at the same x with the same drift is one mark drawn four times.
  let identicalRows = 0
  for (let i = 0; i < 200; i++) {
    const ms = qmarks(`row-${i}`)
    const xs = new Set(ms.map((m) => m.xPct))
    if (xs.size < 2) identicalRows++
  }
  check('a row\'s marks are not all in one place', identicalRows === 0, identicalRows)
}

console.log('\n-- a caller can ask for a different number --')
{
  check('one mark', qmarks('x', 1).length === 1)
  check('none', qmarks('x', 0).length === 0)
  check('the first mark is the same whatever the count',
    JSON.stringify(qmarks('x', 1)[0]) === JSON.stringify(qmarks('x', 6)[0]))
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
