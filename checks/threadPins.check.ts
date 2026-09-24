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
import {
  applyPins, arrangePinned, foldIds, partitionPinned, parsePins, stripOpensForPins, togglePin, unfoldIds,
  FOLD_KEEP, NO_PINS,
} from '../src/ui/threadPins.ts'
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

console.log('\n-- pinned threads start out, and fold away behind the pushpin --')
{
  // Operator, 2026-09-24: "Pinned threads would start open by default, and
  // hideable behind a Pushpin icon." Chosen reading: in the thread strip.
  const pins = [id(c), id(e)]
  const shown = arrangePinned(list, pins, NO_PINS)
  check('unfolded: the pinned threads lead', ids(shown).slice(0, 2).join() === pins.join(), ids(shown))
  const folded = arrangePinned(list, pins, [id(c)])
  check('a folded pinned thread is out of the strip altogether, not back in the order',
    !ids(folded).includes(id(c)) && ids(folded)[0] === id(e), ids(folded))
  check('folding every pin leaves the ordinary list without them',
    ids(arrangePinned(list, pins, pins)).join() === ids([a, b, d]).join(), ids(arrangePinned(list, pins, pins)))
  check('a folded id that is no longer pinned folds nothing (unpinning returns it)',
    ids(arrangePinned(list, [id(e)], [id(c)])).includes(id(c)))
  const part = partitionPinned(pins, [id(e), id(T('!x', '$gone'))])
  check('the partition counts only pinned threads', part.visible.join() === id(c) && part.folded.join() === id(e), part)
  check('nothing pinned, nothing folded: the same array', arrangePinned(list, NO_PINS, [id(c)]) === list)
}

console.log('\n-- the fold list stays small and exact --')
{
  const f = foldIds(foldIds(NO_PINS, ['x', 'y']), ['y', 'z'])
  check('folding appends, without duplicates', f.join() === 'x,y,z', f)
  check('unfolding removes only those', unfoldIds(f, ['y']).join() === 'x,z', unfoldIds(f, ['y']))
  const many = foldIds(NO_PINS, Array.from({ length: FOLD_KEEP + 50 }, (_, i) => 'id' + i))
  check(`it keeps at most ${FOLD_KEEP}, dropping the oldest`, many.length === FOLD_KEEP && many[0] === 'id50', many.length)
}

console.log('\n-- entering a room with pins pulls the strip down, once per entry --')
{
  check('a room with unfolded pins opens it', stripOpensForPins('!chat', null, 1))
  check('not again for the same entry (closing it sticks)', !stripOpensForPins('!chat', '!chat', 1))
  check('not when every pin is folded away', !stripOpensForPins('!chat', null, 0))
  check('not without a room', !stripOpensForPins(null, null, 3))
  const app = readFileSync('src/App.tsx', 'utf8')
  check('App asks the rule with the room\'s pins and this person\'s folds',
    /partitionPinned\(pinned, foldedPins\)\.visible\.length/.test(app) &&
    /stripOpensForPins\(selectedRoomId, pinsOpenedFor\.current, visible\)/.test(app))
  check('a new room forgets the last entry, so returning to #chat opens it again',
    /if \(selectedRoomId !== pinsRoomSeen\.current\) \{\s*\n\s*pinsRoomSeen\.current = selectedRoomId\s*\n\s*pinsOpenedFor\.current = null/.test(app))
  const ts = readFileSync('src/ui/ThreadList.tsx', 'utf8')
  check('the strip arranges through arrangePinned with this person\'s folds',
    /const entries = arrangePinned\(ordered, pinned, folded\)/.test(ts))
  check('the pushpin folds what is out and brings back what is folded',
    /pinParts\.visible\.length > 0 \? fold\(pinParts\.visible\) : unfold\(pinParts\.folded\)/.test(ts))
  const fold = readFileSync('src/client/pinnedFold.ts', 'utf8')
  check('folds are this person\'s, in account data, written through pinSync',
    /net\.41chan\.tc\.pinned_folded/.test(fold) && /makePinSync\(/.test(fold) && (fold.match(/setAccountData\(/g) ?? []).length === 1)
}

console.log('\n-- ThreadList applies the room pins LAST, and every consumer reads the result --')
{
  const ts = readFileSync('src/ui/ThreadList.tsx', 'utf8')
  check('entries is the frozen order with the rooms\' pins arranged in LAST',
    /const ordered = frozenEntries/.test(ts) && /const entries = arrangePinned\(ordered, pinned, folded\)/.test(ts))
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
