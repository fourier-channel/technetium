// Checks for pinned threads (launch-polish L4).
//
// Operator, 2026-09-24: a pinned thread "maintains its position as
// leftmost/first thread on the list no matter what sort method is chosen."
// The rule is ui/threadPins.ts; the composition -- pins applied LAST, after
// the custom arrangement and the hover freeze -- is asserted against
// ThreadList.tsx, because the wrong order there is the likeliest way to break
// the promise while every pure test still passes.
import { applyPins, keepPinnedPlaces, parsePins, togglePin, NO_PINS } from '../src/ui/threadPins.ts'
import { arrangeByCustom } from '../src/ui/threadOrder.ts'
import { readFileSync } from 'node:fs'
import type { ThreadListItem } from '../src/client/useThreadList.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const T = (room: string, root: string) => ({ roomId: room, rootId: root })
const id = (t: { roomId: string; rootId: string }) => `${t.roomId}|${t.rootId}`
const ids = (xs: { roomId: string; rootId: string }[]) => xs.map(id)

const a = T('!r', '$a'), b = T('!r', '$b'), c = T('!r', '$c'), d = T('!s', '$d'), e = T('!s', '$e')
const list = [a, b, c, d, e]

console.log('\n-- a pinned thread is first, whatever order it came in --')
{
  // Every one of these is a different "sort": the pinned thread must lead them all.
  const orders = [list, [...list].reverse(), [c, a, e, b, d], [e, d, c, b, a]]
  let allFirst = true
  for (const o of orders) if (id(applyPins(o, [id(c)])[0]) !== id(c)) allFirst = false
  check('pinning c puts c first under four different orders', allFirst)
  check('and the rest keep their order exactly',
    ids(applyPins([e, d, c, b, a], [id(c)])).join() === ids([c, e, d, b, a]).join(),
    ids(applyPins([e, d, c, b, a], [id(c)])))
}

console.log('\n-- several pins: earlier pins never move --')
{
  const pins = togglePin(togglePin(NO_PINS, id(d)), id(b))
  check('a new pin is appended, not put in front', pins.join() === [id(d), id(b)].join(), pins)
  const out = ids(applyPins(list, pins))
  check('pinned threads lead in pin order', out.slice(0, 2).join() === [id(d), id(b)].join(), out)
  check('then everything else, in its own order', out.slice(2).join() === ids([a, c, e]).join(), out)
  check('unpinning removes only that pin', togglePin(pins, id(d)).join() === id(b), togglePin(pins, id(d)))
}

console.log('\n-- a pin that is not in the list is ignored, never pruned --')
{
  // "Here" in another room, or a room still backfilling: absent is not gone.
  const pins = [id(T('!elsewhere', '$x')), id(c)]
  const out = applyPins(list, pins)
  check('the present pin still leads', id(out[0]) === id(c), ids(out))
  check('the absent pin changes nothing else', out.length === list.length, out.length)
  check('and applyPins does not edit the pin list', pins.length === 2)
}

console.log('\n-- identity is kept when nothing moves --')
{
  check('no pins: the same array comes back', applyPins(list, NO_PINS) === list)
  check('only absent pins: the same array', applyPins(list, [id(T('!x', '$y'))]) === list)
  check('pinned thread already first: the same array', applyPins(list, [id(a)]) === list)
  check('an empty list stays the same array', applyPins([] as typeof list, [id(a)]).length === 0)
}

console.log('\n-- stored content is read loudly, never half-read --')
{
  check('nothing stored is no pins', parsePins(undefined) === NO_PINS && parsePins({}) === NO_PINS)
  check('a list reads as itself', (parsePins({ pins: [id(a), id(b)] }) ?? []).join() === [id(a), id(b)].join())
  check('duplicates keep their first place', (parsePins({ pins: [id(b), id(a), id(b)] }) ?? []).join() === [id(b), id(a)].join())
  check('not an array is refused whole (null, for the caller to report)', parsePins({ pins: 'x' }) === null)
  check('a non-string entry refuses the whole list', parsePins({ pins: [id(a), 7] }) === null)
  check('an empty-string entry refuses the whole list', parsePins({ pins: [id(a), ''] }) === null)
}

console.log('\n-- composed with a custom (drag-arranged) order: the pin still wins --')
{
  // arrangeByCustom puts threads missing from the saved order FIRST, marked
  // new (O3). A pin applied before it would lose to a brand-new thread.
  const items = [a, b, c, d, e] as unknown as ThreadListItem[]
  const saved = ids([a, b, c, d]) // e is new
  const arranged = arrangeByCustom(items, saved).items
  check('premise: a new thread leads a custom order', id(arranged[0]) === id(e), ids(arranged))
  const out = applyPins(arranged, [id(c)])
  check('pinned c still leads it', id(out[0]) === id(c), ids(out))
}

console.log('\n-- a drag with a pinned card saves the pinned thread back in its place --')
{
  // Arrangement A,B,C,D,P; P pinned so the strip shows P,A,B,C,D; the reader
  // drags B to the end. The drag reports P,A,C,D,B.
  const saved = keepPinnedPlaces(['P', 'A', 'C', 'D', 'B'], ['P'], ['A', 'B', 'C', 'D', 'P'])
  check('the drag is kept and P goes back to its own place', saved.join() === 'A,C,D,B,P', saved)
  const fresh = keepPinnedPlaces(['P', 'B', 'A'], ['P'], ['A', 'B'])
  check('a pinned thread the arrangement never held goes last', fresh.join() === 'B,A,P', fresh)
  const none = ['A', 'B']
  check('no pins: the drag is saved as it is', keepPinnedPlaces(none, [], ['B', 'A']).join() === 'A,B')
  const two = keepPinnedPlaces(['Q', 'P', 'A', 'B'], ['Q', 'P'], ['P', 'A', 'Q', 'B'])
  check('two pinned threads each return to their own place', two.join() === 'P,A,Q,B', two)
  // The drag does not measure pinned cards, so its list usually lacks them.
  const absent = keepPinnedPlaces(['A', 'C', 'D', 'B'], ['P'], ['A', 'B', 'C', 'D', 'P'])
  check('a pinned thread absent from the drag\'s list is restored, not dropped', absent.join() === 'A,C,D,B,P', absent)
}

console.log('\n-- ThreadList applies pins LAST, and every consumer reads the result --')
{
  const ts = readFileSync('src/ui/ThreadList.tsx', 'utf8')
  check('entries is applyPins over the arranged-or-frozen order',
    /const ordered = arranged \? arranged\.items : frozenEntries/.test(ts) &&
    /const entries = applyPins\(ordered, pins\)/.test(ts))
  check('nothing re-derives entries after the pins', (ts.match(/const entries = /g) ?? []).length === 1)
  check('a pinned card is never offered to the drag', /\{\.\.\.\(pinned \? \{\} : getCardHandlers\(/.test(ts))
  check('a pinned card is never labelled new', /&& !pinnedIds\.has\(/.test(ts))
  check('a drag saves through keepPinnedPlaces', /const saved = keepPinnedPlaces\(finalIds, cur\.pins, prev\)/.test(ts) && /saveCustomOrder\(orderScopeKey\(scope, roomId\), saved\)/.test(ts))
  const drag = readFileSync('src/ui/threadDrag.ts', 'utf8')
  check('the drag leaves pinned cards out of the slots it measures', /\[data-flip-id\]:not\(\[data-pinned\]\)/.test(drag))
  check('the tile memo compares the pin state', /a\.pinned !== b\.pinned/.test(ts) && /a\.onTogglePin !== b\.onTogglePin/.test(ts))
  check('the pin button stops the card drag and the card click',
    /onPointerDown=\{\(ev\) => ev\.stopPropagation\(\)\}/.test(ts) && /ev\.stopPropagation\(\)\s*\n\s*onTogglePin\(/.test(ts))
  const store = readFileSync('src/client/threadPinStore.ts', 'utf8')
  check('pins live in account data, never in room state',
    /net\.41chan\.tc\.thread_pins/.test(store) && !/m\.room\.pinned_events/.test(store))
  const sync = readFileSync('src/client/pinSync.ts', 'utf8')
  check('a failed save is reported, not swallowed', /reportAlways\('thread pins: save/.test(sync) && !/catch\(\(\) => \{\}\)/.test(sync + store))
  check('the store writes through the one-at-a-time sync, never directly', /makePinSync\(/.test(store) && (store.match(/setAccountData\(/g) ?? []).length === 1)
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
