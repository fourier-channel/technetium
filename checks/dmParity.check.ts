// DM parity with the room you are reading (tc.111). A DM is never
// selectedRoom -- App routes direct rooms to the dock -- so everything hung off
// selectedRoom silently skipped every DM. Three of those, each held here:
//
//   1. Who is typing: the dock carries its own TypingBar for its own room,
//      between the conversation and the composer, as the main column does.
//   2. Which conversation is open: the people list marks the open DM's face,
//      by recolouring the ring it already has plus a halo that takes no room.
//   3. The booru row: NOT unmarked by an open DM. It marks what the main pane
//      holds, and the dock sits over the top of that pane, so with no room
//      selected the booru is still on screen below the DM. The roadmap brief
//      proposed `!selectedRoom && !dockShown`; that reading was declined and
//      this check is here so nobody applies it from the brief.
//
// WHAT THIS CANNOT SEE: that a live homeserver's typing notifications reach
// the dock's bar, or how the faces look in Firefox. Those are the operator's.
import { readFileSync } from 'node:fs'
import { dmFaceStyle, DM_OPEN_RING } from '../src/ui/dmStrip.ts'
import { MIN_PX } from '../src/ui/space.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
// Comments say what the code does; only the code may satisfy a check.
const code = (p: string) => src(p).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

// --- 1. the typing bar ------------------------------------------------------
{
  const dock = code('ui/DmDock.tsx')
  check('the dock imports the one typing bar',
    /import \{ TypingBar \} from '\.\/TypingBar'/.test(dock))
  const body = dock.indexOf('className="tc-dmdock-body"')
  const bar = dock.indexOf('<TypingBar client={client} room={dockRoom as Room} />')
  const composer = dock.indexOf('<Composer room={dockRoom as Room} />')
  check('the dock shows who is typing in ITS room', bar > 0, bar)
  check('the bar sits after the conversation and before the composer',
    body > 0 && body < bar && bar < composer, { body, bar, composer })
  // The bar reserves its height whether or not anyone types, and that height
  // comes out of the conversation. The dock's minimum was 140 for a timeline
  // plus a composer before the bar existed; at 140 the bar left 46px of
  // conversation where there had been 64 (tools/visual/dmdock.html), so the
  // minimum carries the bar on top. Read from the stylesheet, so a taller bar
  // cannot quietly eat the minimum again (D-tc01).
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
  const barPx = Number(/\.tc-typing-bar \{[^}]*?\bheight: (\d+)px/.exec(css)?.[1])
  check('the dock\'s minimum height is the old 140 plus the typing bar',
    barPx > 0 && MIN_PX.dock.y === 140 + barPx, { barPx, min: MIN_PX.dock.y })
  check('the bar is inside the dock\'s composer-mode scope, beside its composer',
    dock.lastIndexOf('<ComposerModeProvider>', bar) > dock.lastIndexOf('</ComposerModeProvider>', bar))
}

// --- 2. the open face -------------------------------------------------------
{
  const states = [
    { ping: false, unread: false }, { ping: false, unread: true },
    { ping: true, unread: false }, { ping: true, unread: true },
  ]
  for (const s of states) {
    const shut = dmFaceStyle({ ...s, open: false })
    const open = dmFaceStyle({ ...s, open: true })
    const changed = Object.keys({ ...shut, ...open })
      .filter((k) => (shut as Record<string, unknown>)[k] !== (open as Record<string, unknown>)[k])
    const tag = `ping=${s.ping} unread=${s.unread}`
    check(`opening a face changes its ring and halo only, never its box (${tag})`,
      changed.every((k) => k === 'border' || k === 'boxShadow') && changed.includes('border'), changed)
    check(`the open border is the closed one's width in the accent (${tag})`,
      String(open.border).replace(DM_OPEN_RING, 'X') === String(shut.border).replace(/rgba\([^)]*\)/, 'X')
        && String(open.border).includes(DM_OPEN_RING), [shut.border, open.border])
    const glow = shut.boxShadow ? String(shut.boxShadow) : ''
    check(`the glow is kept whole and paints first, over the halo (${tag})`,
      String(open.boxShadow).startsWith(glow), [shut.boxShadow, open.boxShadow])
    const halo = String(open.boxShadow).slice(glow ? glow.length + 2 : 0)
    check(`the halo is a solid accent band outside any glow ring (${tag})`,
      halo === `0 0 0 ${glow ? 4 : 2}px ${DM_OPEN_RING}`, halo)
    check(`a face with no word on it is drawn closed (${tag})`,
      JSON.stringify(dmFaceStyle(s)) === JSON.stringify(shut))
  }
  check('the open ring is the accent a selected room row carries',
    DM_OPEN_RING === 'var(--tc-link)' && /inset 3px 0 0 0 var\(--tc-link\)/.test(src('ui/NavTree.tsx')))

  const list = code('ui/DmList.tsx')
  check('each face is drawn open exactly when it is the open conversation',
    list.includes('dmFaceStyle({ ping, unread, open: node.roomId === openRoomId })'))
  check('and says so to a screen reader',
    list.includes("aria-current={node.roomId === openRoomId ? 'true' : undefined}"))
  check('the list takes the open room as a prop, so it mounts without the layout',
    /openRoomId = null/.test(list) && !/useSpace\(/.test(list))
  const members = code('ui/MemberList.tsx')
  check('the people list marks the dock\'s room only while the dock is open',
    members.includes('openRoomId={space.leaves.dock.open ? dockRoom?.roomId ?? null : null}'))
}

// --- 3. the booru row -------------------------------------------------------
{
  const app = code('App.tsx')
  const m = /booruActive=\{([^}]*)\}/.exec(app)
  check('the booru row follows the main pane alone: no room selected',
    m?.[1] === '!selectedRoom', m?.[1])
  check('and the main pane shows the booru exactly then',
    /\{selectedRoom \? \([\s\S]*?\) : \(\s*<BooruFrame \/>\s*\)\}/.test(app))
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
