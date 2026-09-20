// "Is this a DM?" is asked in one place, and this is the place.
//
// The gap this closes: the DM strip asks isDirect (classifyRoom -- a stamped
// create-event class FIRST, then m.direct) while the context menu asked
// directRoomIds on its own. A DM stamped at creation and missing from the map
// is drawn as a person in the strip and would have been offered "Leave room".
// Two answers to one question, which D-tc01 exists to forbid.
import { readFileSync } from 'node:fs'
import { isDirect } from '../src/client/roomClass.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

console.log('== the two surfaces ask the same function')
const menu = readFileSync(new URL('../src/ui/RoomContextMenu.tsx', import.meta.url), 'utf8')
const nav = readFileSync(new URL('../src/ui/NavTree.tsx', import.meta.url), 'utf8')
check('the context menu asks isDirect', /\bisDirect\(/.test(menu))
check('the DM strip asks isDirect', /\bisDirect\(/.test(nav))
check('the context menu does NOT re-derive it from m.direct',
  !/directRoomIds\(/.test(menu),
  'directRoomIds in the menu is a second answer to a question isDirect already answers')

console.log('== and the function prefers the stamp over the map')
// This is the difference that made the drift invisible: a room stamped at
// creation is a DM even when m.direct has never heard of it.
const stamped = {
  roomId: '!s:x',
  currentState: { getStateEvents: () => null },
} as never
const client = {
  getAccountData: () => ({ getContent: () => ({}) }),
} as never
check('a room in neither is not a DM', isDirect(client, stamped) === false)

const inMap = {
  getAccountData: () => ({ getContent: () => ({ '@them:x': ['!s:x'] }) }),
} as never
check('a room only in m.direct IS a DM', isDirect(inMap, stamped) === true)

console.log('== the close affordance does NOT depend on the classifier')
// Two kinds of window could not be closed at all while it did: a conversation
// with three people in it, which the server stamps `room` and the stamp beats
// m.direct; and a DM whose other person left before it was ever opened, never
// adopted into m.direct on this side. classifyRoom is right to refuse both --
// it answers what a room IS. The affordance asks where the click came from.
check('the menu takes a `conversation` prop', /conversation\s*=\s*false/.test(menu) && /conversation\?:\s*boolean/.test(menu))
check('and it alone can make the item appear',
  /conversation \|\| \(!!client/.test(menu),
  'the surface must be able to say yes without the classifier agreeing')
check('the DM strip says yes for its own rows', /onContext\(node, e, true\)/.test(nav))
check('the menu is handed it', /conversation=\{menu\.conversation\}/.test(nav))
check('a space is still never a conversation', /!node\.isSpace && \(conversation/.test(menu))

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\ndm one question: all checks passed')
