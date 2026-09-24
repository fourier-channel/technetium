// Checks for the thread carousel's mouse wheel: one notch is one card.
//
// Operator, 2026-09-24: "two positions per single mousewheel tick, it should
// be just one." The old rule spent a running total 40px at a time in a loop,
// so a 100px Chrome notch went 2, 3, 2, 3 and a 120px notch 3 every time.
// These fold realistic event streams through wheelStep and count the steps.
import { wheelStep, WHEEL_IDLE, type WheelInput, type WheelState } from '../src/ui/carousel.ts'
import { readFileSync } from 'node:fs'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

// Fold a stream of events and report the steps each GROUP produced, where a
// group is one notch (or one detent's worth of hi-res events).
function run(groups: WheelInput[][]): number[] {
  let s: WheelState = WHEEL_IDLE
  return groups.map((g) => {
    let n = 0
    for (const ev of g) {
      const r = wheelStep(s, ev)
      s = r.state
      n += r.step
    }
    return n
  })
}

// n notches of `dy` pixels (or lines/pages via mode), `gap` ms apart.
function notches(n: number, dy: number, gap: number, mode = 0): WheelInput[][] {
  return Array.from({ length: n }, (_, i) => [{ dx: 0, dy, mode, t: 1000 + i * gap }])
}

// A hi-res detent: k events of `each` px, 4ms apart, detents `gap` ms apart.
function hiRes(n: number, k: number, each: number, gap: number): WheelInput[][] {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: k }, (_, j) => ({ dx: 0, dy: each, mode: 0, t: 1000 + i * gap + j * 4 })))
}

const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i])

console.log('\n-- a single notch is exactly one card --')
for (const px of [100, 120, 80, 53, 33, 400]) {
  check(`a single ${px}px notch steps once`, same(run(notches(1, px, 0)), [1]), run(notches(1, px, 0)))
}
check('a line-mode notch (3 lines) steps once', same(run(notches(1, 3, 0, 1)), [1]))
check('a page-mode notch steps once', same(run(notches(1, 1, 0, 2)), [1]))
check('scrolling up steps back once', same(run(notches(1, -100, 0)), [-1]))

console.log('\n-- six notches in a row are six cards, slow or fast --')
// The history-independence case: the old rule's remainder made each notch
// depend on the ones before it.
for (const px of [100, 120, 80, 39, 48, 57, 114]) {
  for (const gap of [300, 40]) {
    const got = run(notches(6, px, gap))
    check(`${px}px notches ${gap}ms apart: one each`, same(got, [1, 1, 1, 1, 1, 1]), got)
  }
}
{
  const got = run(notches(6, 3, 40, 1))
  check('line-mode notches 40ms apart: one each', same(got, [1, 1, 1, 1, 1, 1]), got)
}

console.log('\n-- small notches at a natural pace: one card each, no stall --')
// Review of the first fix: notch SIZE cannot tell a notch from a stream. A
// slow tick of an ordinary mouse in Chrome on macOS is about 4px, Firefox at
// one line per notch about 16-19px, and a steady roll of those moved one card
// and stalled. Timing tells them apart.
for (const [px, gap] of [[4.000244140625, 150], [4, 190], [8, 120], [16, 120], [19, 100], [33, 100]] as const) {
  const got = run(notches(12, px, gap))
  check(`12 notches of ${px}px ${gap}ms apart: twelve cards`, got.every((n) => n === 1), got)
}
{
  // macOS acceleration: ticks grow as the wheel speeds up.
  const ramp = [4, 4, 8, 8, 12, 12, 16, 20, 24, 28, 32, 40]
  const got = run(ramp.map((px, i) => [{ dx: 0, dy: px, mode: 0, t: 1000 + i * 110 }]))
  check('an accelerating roll, 110ms apart: one card per notch', got.every((n) => n === 1), got)
}

console.log('\n-- a high-resolution wheel: one card per detent --')
for (const [k, each, gap] of [[8, 12.5, 120], [8, 57 / 8, 90], [8, 48 / 8, 60], [8, 120 / 8, 120], [8, 120 / 8, 60], [4, 25, 80]] as const) {
  const got = run(hiRes(6, k, each, gap))
  check(`${k} x ${each.toFixed(2)}px detents ${gap}ms apart: one each`, got.every((n) => n === 1), got)
}
{
  // Faster than that the detents run together into one stream; it may move
  // fewer cards than detents, never more.
  const got = run(hiRes(6, 8, 12.5, 40))
  const total = got.reduce((a, b) => a + b, 0)
  check('a very fast hi-res spin moves at least one card and never more than one per detent',
    total >= 1 && got.every((n) => n <= 1), got)
}

console.log('\n-- a trackpad does not fling across the list --')
{
  const slow = [Array.from({ length: 60 }, (_, j) => ({ dx: 0, dy: 3, mode: 0, t: 1000 + j * 16 }))]
  const got = run(slow)[0]
  check('a slow 60 x 3px drag is one or two cards', got >= 1 && got <= 2, got)
  // A macOS fling with momentum: ramp to 110px/frame, then 0.95 decay.
  const fling: WheelInput[] = []
  let v = 10, t = 1000
  for (let i = 0; i < 99; i++) {
    v = i < 8 ? Math.min(110, v + 15) : v * 0.95
    fling.push({ dx: 0, dy: v, mode: 0, t })
    t += 16
  }
  const flingTotal = run([fling])[0]
  check('a hard fling with momentum moves a handful of cards, not the list', flingTotal >= 2 && flingTotal <= 8, flingTotal)
  const flick = [Array.from({ length: 20 }, (_, j) => ({ dx: 0, dy: 35, mode: 0, t: 1000 + j * 8 }))]
  const flickTotal = run(flick)[0]
  check('a quick precision-touchpad flick is one or two cards', flickTotal >= 1 && flickTotal <= 2, flickTotal)
  for (const amp of [1.5, 2.5]) {
    const jitter = [Array.from({ length: 30 }, (_, j) => ({ dx: 0, dy: j % 2 ? amp : -amp, mode: 0, t: 1000 + j * 16 }))]
    check(`a resting finger's +/-${amp}px jitter moves nothing`, run(jitter)[0] === 0, run(jitter))
  }
}

console.log('\n-- direction and axis --')
{
  const got = run([[{ dx: 0, dy: 100, mode: 0, t: 1000 }], [{ dx: 0, dy: -100, mode: 0, t: 1030 }]])
  check('a reversal 30ms later is +1 then -1', same(got, [1, -1]), got)
  const quick = run([[{ dx: 0, dy: 100, mode: 0, t: 1000 }], [{ dx: 0, dy: -100, mode: 0, t: 1008 }]])
  check('a decisive reversal inside a stream is +1 then -1 too', same(quick, [1, -1]), quick)
  check('a sideways wheel (dx dominant) steps right', same(run([[{ dx: 120, dy: 10, mode: 0, t: 1000 }]]), [1]))
  check('and left', same(run([[{ dx: -120, dy: 10, mode: 0, t: 1000 }]]), [-1]))
}

console.log('\n-- garbage in, nothing out --')
{
  const bad: WheelInput[] = [
    { dx: 0, dy: NaN, mode: 0, t: 1000 },
    { dx: 0, dy: Infinity, mode: 0, t: 1000 },
    { dx: 0, dy: 100, mode: 0, t: NaN },
  ]
  for (const ev of bad) {
    const r = wheelStep(WHEEL_IDLE, ev)
    check(`${JSON.stringify(ev)} steps 0 and leaves state alone`, r.step === 0 && r.state === WHEEL_IDLE, r)
  }
}

console.log('\n-- seeded fuzz: one step at most, state always finite --')
{
  // mulberry32, so a failure reproduces.
  let seed = 0x5eed
  const rnd = () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  let s: WheelState = WHEEL_IDLE
  let t = 0
  let ok = true
  let bad: unknown = null
  for (let i = 0; i < 20000 && ok; i++) {
    t += Math.floor(rnd() * 500)
    const ev = { dx: (rnd() - 0.5) * 2000, dy: (rnd() - 0.5) * 2000, mode: Math.floor(rnd() * 3), t }
    const r = wheelStep(s, ev)
    if (![-1, 0, 1].includes(r.step) || !Number.isFinite(r.state.acc) || r.state.acc < 0) {
      ok = false
      bad = { ev, r }
    }
    s = r.state
  }
  check('20000 random events: every step is -1, 0 or 1 and the state stays finite', ok, bad)
}

console.log('\n-- the component hands off to wheelStep and keeps no second rule --')
{
  // A text match proves only the text; the assertions above are what test
  // the rule. This catches a second copy of it creeping back into the view.
  const ts = readFileSync('src/ui/ThreadList.tsx', 'utf8')
  const handler = /const onWheel = useCallback\([\s\S]*?\n {2}\}, \[/.exec(ts)?.[0] ?? ''
  check('onWheel is found', handler.length > 0)
  check('onWheel calls wheelStep', handler.includes('wheelStep('))
  check('onWheel has no loop of its own', !/\bwhile\s*\(/.test(handler) && !/THRESHOLD/.test(handler), handler)
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
