// Checks for where an attached popup goes (launch-polish L5).
//
// "Unfurling to the right, with a true attached popup behavior that covers
// the user list if needed -- don't constrain it to its own panel." So: the
// popup's top-left sits on its control and it grows right and down; only the
// WINDOW clamps it.
import { placeUnfurl, POPUP_MARGIN } from '../src/ui/popupPlacement.ts'
import { readFileSync } from 'node:fs'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const vp = { w: 1440, h: 900 }
const btn = (left: number, top: number, w = 90, h = 20) => ({ left, top, right: left + w, bottom: top + h })

console.log('\n-- it opens ON its control and unfurls rightward --')
{
  const p = placeUnfurl(btn(400, 300), { w: 360, h: 200 }, vp)
  check('top-left on the control', p.x === 400 && p.y === 300, p)
  // The member list is to the right of the chat; nothing here stops the
  // popup at the chat's edge, only at the window's.
  const q = placeUnfurl(btn(1000, 300), { w: 400, h: 200 }, vp)
  check('it may run over whatever is beside it, up to the window', q.x === 1000 && q.x + 400 <= vp.w - POPUP_MARGIN, q)
}

console.log('\n-- the window clamps it, and only as far as it must --')
{
  const p = placeUnfurl(btn(1300, 300), { w: 400, h: 200 }, vp)
  check('near the right edge it slides left just enough', p.x === vp.w - POPUP_MARGIN - 400, p)
  const q = placeUnfurl(btn(400, 800), { w: 360, h: 300 }, vp)
  check('near the bottom it slides up just enough', q.y === vp.h - POPUP_MARGIN - 300, q)
  const r = placeUnfurl(btn(2, 2), { w: 100, h: 100 }, vp)
  check('never past the top-left margin', r.x === POPUP_MARGIN && r.y === POPUP_MARGIN, r)
  const tall = placeUnfurl(btn(400, 300), { w: 360, h: 5000 }, vp)
  check('taller than the window: capped, and it scrolls', tall.maxH === vp.h - 2 * POPUP_MARGIN && tall.y === POPUP_MARGIN, tall)
  const wide = placeUnfurl(btn(400, 300), { w: 5000, h: 100 }, vp)
  check('wider than the window: pinned to the left margin', wide.x === POPUP_MARGIN, wide)
}

console.log('\n-- whole pixels, always --')
{
  const p = placeUnfurl({ left: 400.4, top: 300.6, right: 490.4, bottom: 320.6 }, { w: 360, h: 200 }, vp)
  check('rounded', Number.isInteger(p.x) && Number.isInteger(p.y), p)
}

console.log('\n-- the component uses the rule and escapes every clip --')
{
  const src = readFileSync('src/ui/AnchoredPopup.tsx', 'utf8')
  check('portalled to <body>', /createPortal\([\s\S]*document\.body/.test(src))
  check('placed by placeUnfurl, from the control\'s rect less the popup\'s own inset',
    /placeUnfurl\(\s*\n?\s*\{ left: a\.left - nudgeX, top: a\.top - nudgeY/.test(src))
  check('follows its control every frame (a carousel moves it by transform, which fires nothing)',
    /raf = requestAnimationFrame\(place\)/.test(src))
  check('closes when the control is clipped out of view by ANY ancestor, not just a scroller',
    /new IntersectionObserver\(/.test(src) && /io\?\.observe\(anchor\)/.test(src))
  check('an outside press blurs a field inside first, so its commit-on-blur runs',
    /if \(active instanceof HTMLElement && pop\.contains\(active\)\) active\.blur\(\)/.test(src))
  check('a dismissal that is not on a control closes only the innermost layer',
    /document\.addEventListener\('click', swallowClick, \{ capture: true, once: true \}\)/.test(src))
  check('focus goes back to the control however the popup closed', /anchor\.focus\(\{ preventScroll: true \}\)/.test(src))
  check('Escape is taken in the capture phase and stopped (the lightbox also closes on it)',
    /addEventListener\('keydown', onKeyDown, true\)/.test(src) && /e\.stopPropagation\(\)\s*\n\s*e\.preventDefault\(\)/.test(src))
  for (const ev of ['onClick', 'onDoubleClick', 'onPointerDown', 'onPointerUp', 'onPointerMove', 'onMouseDown', 'onMouseUp', 'onWheel', 'onContextMenu', 'onFocus', 'onBlur', 'onKeyDown']) {
    check(`portal ${ev} does not bubble to the card, strip or backdrop behind it`, new RegExp(`${ev}=\\{stop\\}`).test(src))
  }
  check('positioned imperatively, not through React state', !/useState/.test(src))
  const css = readFileSync('src/index.css', 'utf8')
  const block = /\.tc-anchored-pop \{([^}]*)\}/.exec(css)?.[1] ?? ''
  check('fixed, over the page', /position:\s*fixed/.test(block))
  check('above the lightbox (1000) and below dialogs (2000)', /z-index:\s*1001/.test(block), block)
  check('never seen before it is placed', /\.tc-anchored-pop:not\(\[data-placed\]\)\s*\{\s*visibility:\s*hidden/.test(css))
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
