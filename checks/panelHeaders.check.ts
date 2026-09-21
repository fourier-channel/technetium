// Two headers must not say the same thing, and must never say DIFFERENT
// things about the same fact.
//
// Reported by the operator, 2026-09-21: "redundant frame headers when DMs
// threads etc are open". The thread panel's header read "Thread - <room>"
// always, while the timeline it sits beside carries the same name in its own
// header -- so with a thread open the room was named twice on one screen.
//
// The worse half was invisible: the two read DIFFERENT SOURCES. The timeline
// shows the user's rename (RoomHeaderInfo: settings.getRename ?? room.name);
// the thread panel showed room.name. Rename a room and the two headers
// contradicted each other. That is D-tc01's case exactly -- one fact, two
// implementations, agreeing today.
import { readFileSync } from 'node:fs'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const read = (p: string) => readFileSync(new URL('../src/ui/' + p, import.meta.url), 'utf8')
const threadPanel = read('ThreadPanel.tsx')
const roomHeaderInfo = read('RoomHeaderInfo.tsx')

console.log('== the room is named once per screen')
check('the thread panel names the room only when it is alone',
  /Thread\{alone && room \?/.test(threadPanel),
  'with the timeline beside it, the name is already on screen')
check('and it does say it when it IS alone',
  /singleSlot: alone/.test(threadPanel),
  'on a one-slot screen the thread can be the sole occupant and nothing else names the room')
check('the old unconditional form is gone',
  !/Thread\{room \?/.test(threadPanel))

console.log('== and both headers get the name from the same place')
// A rename must not make one header disagree with the other.
check('the timeline header prefers the rename',
  /settings\.getRename\(room\.roomId\) \?\? room\.name/.test(roomHeaderInfo))
check('the thread panel prefers the rename too',
  /settings\.getRename\(roomId\) \?\? name/.test(threadPanel))
check('the thread panel no longer reads room.name raw for its label',
  !/\$\{room\.name \|\| roomId\}/.test(threadPanel))

console.log('== the headers that are NOT duplicates keep their content')
// Each of these says something no other bar on screen says, so none of them
// is what the operator was looking at.
const dmDock = read('DmDock.tsx')
const threadList = read('ThreadList.tsx')
check('the DM dock still names the person it is a conversation with', /tc-dmdock-title/.test(dmDock))
check('the DM dock still says what it is', /Direct message/.test(dmDock))
check('the thread list head still carries its controls', /tc-carousel-head tc-panel-head/.test(threadList))

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\npanel headers: all checks passed')
