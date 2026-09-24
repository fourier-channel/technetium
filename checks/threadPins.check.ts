// Checks for pinned threads (launch-polish L4).
//
// Operator, 2026-09-24: a pinned thread "maintains its position as
// leftmost/first thread on the list no matter what sort method is chosen" --
// "an admin-pinned thread that has priority over all others". The rule is
// ui/threadPins.ts; where pins live (room state, moderators only) is
// client/threadPinState.ts; the composition -- pins applied LAST, after the
// hover freeze -- is asserted against ThreadList.tsx, because the wrong order
// there is the likeliest way to break the promise while every pure test
// still passes.
import { applyPins, parsePins, togglePin, NO_PINS } from '../src/ui/threadPins.ts'
import { readFileSync } from 'node:fs'

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

console.log('\n-- ThreadList applies the room pins LAST, and every consumer reads the result --')
{
  const ts = readFileSync('src/ui/ThreadList.tsx', 'utf8')
  check('entries is applyPins over the frozen order and the rooms\' pins',
    /const ordered = frozenEntries/.test(ts) && /const entries = applyPins\(ordered, pinned\)/.test(ts))
  check('nothing re-derives entries after the pins', (ts.match(/const entries = /g) ?? []).length === 1)
  check('the pins are read from room state, not from the viewer\'s own data',
    /threadPinsOf\(client, r\)/.test(ts) && !/useThreadPins\(/.test(ts))
  check('only those the room allows get the control; everyone else sees a mark',
    /canPin=\{canPinThreads\(client\?\.getRoom\(e\.roomId\), myUserId\)\}/.test(ts) &&
    /\{canPin \? \(/.test(ts) && /className="tc-tcard-pin is-mark"/.test(ts))
  check('the tile memo compares the pin state and the permission',
    /a\.pinned !== b\.pinned/.test(ts) && /a\.canPin !== b\.canPin/.test(ts) && /a\.onTogglePin !== b\.onTogglePin/.test(ts))
  check('the pin button stops the card click', /ev\.stopPropagation\(\)\s*\n\s*onTogglePin\(/.test(ts))
  check('drag-to-reorder is gone from the thread list (operator, 2026-09-24)',
    !/useThreadDrag|getCardHandlers|arrangeByCustom|customOrder|'custom'/.test(ts))

  const state = readFileSync('src/client/threadPinState.ts', 'utf8')
  check('pins are one room state event', /THREAD_PINS_EVENT = 'net\.41chan\.thread\.pins'/.test(state))
  check('written as room state, through the one-at-a-time sync',
    /makePinSync\(/.test(state) && /send\(roomId, THREAD_PINS_EVENT, \{ pins \}, ''\)/.test(state))
  check('never the viewer\'s account data, never pinned MESSAGES',
    !/setAccountData\(/.test(state) && !/'m\.room\.pinned_events'/.test(state))
  check('who may pin is asked of the room\'s power levels', /maySendStateEvent/.test(state))
  const sliding = readFileSync('src/client/slidingSync.ts', 'utf8')
  check('sliding sync asks for the pin state, or no client would ever see a pin',
    /\['net\.41chan\.thread\.pins', ''\]/.test(sliding))
  const sync = readFileSync('src/client/pinSync.ts', 'utf8')
  check('a failed save is reported, not swallowed', /reportAlways\(`\$\{subject\}: save/.test(sync) && !/catch\(\(\) => \{\}\)/.test(sync))
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
