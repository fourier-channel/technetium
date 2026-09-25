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

console.log('== the DM dock is ONE bar')
// Launch-polish L9, operator 2026-09-25: the title bars were "too thick". The
// dock stacked its own bar -- the person's name and "Direct message" -- over
// the room header of the timeline inside it, naming the person twice. What only
// the dock knows now rides in that one header.
const dmDock = read('DmDock.tsx')
const timeline = read('Timeline.tsx')
check('the dock draws no bar of its own', !/tc-dmdock-head|tc-dmdock-title/.test(dmDock))
check('the dock still says what it is, inside the timeline header',
  /headLead=\{<span className="tc-dmdock-hint"[^>]*>Direct message<\/span>\}/.test(dmDock))
check('its edit-mode chrome rides in the same header',
  /headTrail=\{editMode \? <PanelChrome id="dock" inline \/> : undefined\}/.test(dmDock))
check('the timeline header renders what its host hands it, around the room label',
  /<header className="tc-panel-head tc-titlebar">\s*\{headLead\}\s*<RoomHeaderInfo/.test(timeline) &&
  /\{headTrail\}\s*<\/header>/.test(timeline))

console.log('== the headers that are NOT duplicates keep their content')
const threadList = read('ThreadList.tsx')
check('the thread list head still carries its controls', /tc-carousel-head tc-panel-head/.test(threadList))

console.log('== title bars are a declared height, and their buttons are the header pill')
// L9: "restyle the buttons so they're not all Windows 3.1". The browser's own
// button was the Windows 3.1; the pill is the thread strip's, one rule for both.
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const threadPanel2 = read('ThreadPanel.tsx')
check('the room and thread bars wear the title bar class',
  /className="tc-panel-head tc-titlebar"/.test(timeline) && /className="tc-panel-head tc-titlebar"/.test(threadPanel2))
check('the title bar is a declared height, half or less of the 51px it measured',
  /\.tc-titlebar \{[^}]*height: var\(--tc-titlebar-h\);/.test(css) &&
  Number(/--tc-titlebar-h: (\d+)px/.exec(css)?.[1] ?? 99) <= 26)
check('every button in the room header is a header pill',
  (() => {
    const head = /<header className="tc-panel-head tc-titlebar">([\s\S]*?)<\/header>/.exec(timeline)?.[1] ?? ''
    const buttons = head.match(/<button[\s\S]*?>/g) ?? []
    return buttons.length >= 5 && buttons.every((b) => /className="tc-head-pill"/.test(b) && !/style=/.test(b))
  })())
check('the header pill and the thread strip pill are ONE rule',
  /\.tc-threadlist-pill,\s*\n\.tc-head-pill \{/.test(css))

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\npanel headers: all checks passed')
