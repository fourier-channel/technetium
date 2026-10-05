// Pull tabs ride their panels (operator, 2026-10-05: "the panel slides open
// but the BUTTON teleports to the new spot. very janky"). The geometry is
// proved here; the motion is measured frame by frame in Chromium by
// tools/visual/tabride.sh (tab side vs panel edge, open and close, before
// and after). These also hold the source to ONE tab per panel, riding on its
// panel's own clock and curve, by transform only.
import { readFileSync } from 'node:fs'
import { dockShareCss, railStyle, railTransform, tabAttach, threadTabGeometry } from '../src/ui/tabRide.ts'
import { THREAD_TAB_TOP_EDGE, MEMBERS_TAB_TOP, SIDE_TAB_SPREAD, PULLTAB_W } from '../src/ui/threadStrip.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const app = read('src/App.tsx')
const css = read('src/index.css')

console.log('== which side of the edge')
check('open: inside the panel, at once (hidden behind the border while the edge is still there)', tabAttach(true, false) === 'end' && tabAttach(true, true) === 'end')
check('closing: still inside, riding the edge out of sight, while the panel is on screen', tabAttach(false, true) === 'end')
check('closed and gone: outside the border it pulls from', tabAttach(false, false) === 'start')

console.log('== the rail moves by transform, along the panel\'s axis')
check('down the screen for the top panels', railTransform('y', '188px') === 'translateY(188px)')
check('across for the side panel', railTransform('x', '-380px') === 'translateX(-380px)')
{
  const st = railStyle('y', '50%', 420)
  check('with the panel\'s duration, and nothing but transform set', st.transform === 'translateY(50%)' && st.transitionDuration === '420ms' &&
    Object.keys(st).sort().join() === 'transform,transitionDuration', st)
}
check('the dock\'s share as CSS: tenths of a percent, the dock\'s own rounding', dockShareCss(0.4567) === '45.7%' && dockShareCss(0) === '0%')

console.log('== the thread view\'s edge')
{
  const desk = threadTabGeometry(true, 220, 7, 380, true)
  check('desktop: the view\'s right edge is the member list\'s border, and open moves its left edge W further', desk.r0 === 227 && desk.offset === '-380px', desk)
  check('closed, the rail is home', threadTabGeometry(true, 220, 7, 380, false).offset === '0px')
  const phone = threadTabGeometry(false, 220, 7, 390, true)
  check('a phone (no member list): the screen\'s right edge, and the open edge is the screen\'s left -- the old "Back" spot',
    phone.r0 === 0 && phone.offset === '-390px', phone)
  // Its closed spot there is the screen's right edge, which the Members tab
  // shares: one slot below it, clear of it.
  const centre = (s: string) => Number(/50% \+ (\d+(?:\.\d+)?)px/.exec(s)?.[1] ?? NaN)
  check('on that edge, a whole tab and a gap below the Members tab', centre(THREAD_TAB_TOP_EDGE) - centre(MEMBERS_TAB_TOP) >= PULLTAB_W + 8 &&
    centre(THREAD_TAB_TOP_EDGE) - centre(MEMBERS_TAB_TOP) === SIDE_TAB_SPREAD, { THREAD_TAB_TOP_EDGE, MEMBERS_TAB_TOP })
}

console.log('== one tab per panel, mounted for good')
for (const target of ['dock', 'threads', 'thread', 'sidebar', 'members']) {
  const n = (app.match(new RegExp(`target="${target}"`, 'g')) ?? []).length
  check(`${target}: exactly one PullTab`, n === 1, n)
}
check('the label and the chevron flip with the state, on the same element',
  /pull=\{dockShown \? 'up' : 'down'\}/.test(app) && /pull=\{threadListOpen \? 'up' : 'down'\}/.test(app) && /pull=\{openThread \? 'right' : 'left'\}/.test(app))

console.log('== each rides its panel\'s own edge, clock and curve')
check('dock: the edge DmDock draws (dockShareCss of the same share), on a 420ms reveal like its stylesheet',
  /offset=\{dockShown \? dockShareCss\(dockShareOfMain\) : '0px'\} durationMs=\{dockReveal\.durationMs\}/.test(app) &&
  /const dockReveal = useReveal\(dockShown, 420\)/.test(app) && /height: shown \? dockShareCss\(share\) : 0/.test(read('src/ui/DmDock.tsx')) &&
  /\.tc-dmdock \{[^}]*transition: height 420ms var\(--tc-panel-ease\);/.test(css))
check('thread strip: the tile\'s own height on the tile\'s own reveal',
  /height: threadListReveal\.shown \? threadStripH : 0,\s*\n\s*transitionDuration: `\$\{threadListReveal\.durationMs\}ms`/.test(app) &&
  /offset=\{threadListReveal\.shown \? threadStripH : '0px'\} durationMs=\{threadListReveal\.durationMs\}/.test(app))
check('thread view: the tile\'s own width on the tile\'s own reveal',
  /width: threadPanelReveal\.shown \? threadPanelWidth : 0, transitionDuration: `\$\{threadPanelReveal\.durationMs\}ms`/.test(app) &&
  /threadTabGeometry\(space\.leaves\.members\.open, membersWidth, DIVIDER_PX, threadPanelWidth, threadPanelReveal\.shown\)/.test(app) &&
  /durationMs=\{threadPanelReveal\.durationMs\}/.test(app))
check('the side changes on the panel\'s reveal: inside while it is on screen',
  /tabAttach\(dockShown, dockReveal\.mounted\)/.test(app) && /tabAttach\(threadListOpen, threadListReveal\.mounted\)/.test(app) &&
  /tabAttach\(!!openThread, threadPanelReveal\.mounted\)/.test(app))
const ease = /--tc-panel-ease: (cubic-bezier\([^)]*\));/.exec(css)?.[1]
check('one easing, named once', !!ease && (css.match(/--tc-panel-ease:/g) ?? []).length === 1)
check('every sliding panel and the rail use it',
  /\.tc-domain-tile, \.tc-threadview-tile \{[^}]*transition: width 420ms var\(--tc-panel-ease\);/.test(css) &&
  /\.tc-threads-tile \{ transition: height 380ms var\(--tc-panel-ease\); \}/.test(css) &&
  /\.tc-dmdock-inner \{[^}]*transition: transform 420ms var\(--tc-panel-ease\);/.test(css) &&
  /\.tc-tabrail \{[^}]*transition-timing-function: var\(--tc-panel-ease\);/.test(css))

console.log('== cheap, and quiet at rest')
{
  const rail = /\.tc-tabrail \{([^}]*)\}/.exec(css)?.[1] ?? ''
  check('the rail transitions transform and nothing else', /transition-property: transform;/.test(rail) && !/transition:/.test(rail), rail)
  check('no animation on it (a transition ends; an infinite animation costs a core)', !/animation/.test(rail))
  const tab = /\.tc-pulltab \{([^}]*)\}/.exec(css)?.[1] ?? ''
  check('the tab itself animates no position', !/transition:[^;]*(top|left|right|bottom|transform)/.test(tab), tab)
  check('reduced motion: the rail does not move either', /@media \(prefers-reduced-motion: reduce\) \{ \.tc-tabrail \{ transition: none; \} \}/.test(css))
  check('and the reveal it reads gives 0ms under reduced motion', /const duration = reduced \? 0 : durationMs/.test(read('src/ui/useReveal.ts')))
  check('the side is a transform in the stylesheet, by the tab\'s own size',
    /\.tc-pulltab\[data-attach='above'\] \{ transform: translate\(-50%, -100%\); \}/.test(css) &&
    /\.tc-pulltab\[data-attach='right'\] \{ transform: translate\(100%, -50%\); \}/.test(css))
  const clip = /\.tc-tabclip \{([^}]*)\}/.exec(css)?.[1] ?? ''
  check('the clip and the rail take no pointer; only the tab does',
    /pointer-events: none/.test(clip) && /pointer-events: none/.test(rail) && /\.tc-tabrail > \.tc-pulltab \{ pointer-events: auto; \}/.test(css))
}

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\ntab ride: all checks passed')
