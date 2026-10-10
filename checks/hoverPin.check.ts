// A hover-pin popup (the beta notice, a room's topic): hover previews (mouse only), a click pins, the next
// click closes, a press outside or Escape closes whatever opened it.
//
// WHAT THIS CANNOT SEE: that useHoverPin wires these events to these handlers,
// or how the popup looks. Those are tools/visual/betabanner.html (the shape)
// and a real browser (the behaviour).
import { nextHoverPin, type HoverPinEvent, type HoverPinState } from '../src/ui/hoverPin.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const run = (events: HoverPinEvent[], from: HoverPinState = 'closed') => events.reduce(nextHoverPin, from)
const enter = (pointerType: string): HoverPinEvent => ({ kind: 'enter', pointerType })
const leave = (pointerType: string): HoverPinEvent => ({ kind: 'leave', pointerType })
const click: HoverPinEvent = { kind: 'click' }
const dismiss: HoverPinEvent = { kind: 'dismiss' }

check('a mouse hovering previews the notice', run([enter('mouse')]) === 'hover')
check('and leaving closes the preview', run([enter('mouse'), leave('mouse')]) === 'closed')
check('a click while previewing pins it', run([enter('mouse'), click]) === 'pinned')
check('a pinned notice survives the mouse leaving', run([enter('mouse'), click, leave('mouse')]) === 'pinned')
check('the next click closes it', run([enter('mouse'), click, click]) === 'closed')

// A tap fires pointerenter, then click, then (on some browsers) pointerleave.
// If the touch's enter opened a preview, the click would toggle it shut.
check('a tap opens it and keeps it open', run([enter('touch'), click, leave('touch')]) === 'pinned')
check('a second tap closes it', run([enter('touch'), click, leave('touch'), enter('touch'), click, leave('touch')]) === 'closed')
check('a pen behaves like a tap', run([enter('pen'), click]) === 'pinned')
// What "mouse only" is FOR: a touch that starts on the strip and becomes a
// scroll, not a tap, gets no click. A preview it opened would never close,
// because only a mouse leaving closes a preview.
check('a touch that is not a tap opens nothing', run([enter('touch'), leave('touch')]) === 'closed')

check('a press outside closes a pin', run([click, dismiss]) === 'closed')
check('and a preview', run([enter('mouse'), dismiss]) === 'closed')
check('a mouse entering does not demote a pin', run([enter('mouse')], 'pinned') === 'pinned')

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
