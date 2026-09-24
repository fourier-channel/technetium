// The thread strip is as tall as what is in it, and no taller.
//
// Reported by the operator 2026-09-21: "The thread LIST view is too tall for
// the cards that occupy it." Its height came from the layout alone -- 0.22 of
// the viewport by default -- while the contents are a fixed 124px card under a
// small header, and the track is flex:1, so every surplus pixel became empty
// space around the card.
//
// space.ts had a pixel FLOOR for the strip and no ceiling, because nothing
// there knew how tall the content was. The first fix capped a share at the
// content's height and got that height wrong (the header rendered 11px taller
// than budgeted, the card 2px), so it cropped the card instead. Reported again
// 2026-09-24 ("all that dead space above and below the thread cards"): the
// strip is now exactly the sum of parts the CSS DECLARES, and every part is
// compared here against the stylesheet that draws it.
import { readFileSync } from 'node:fs'
import {
  THREAD_CARD_H, THREAD_HEAD_H, THREAD_TRACK_PAD_TOP, THREAD_TRACK_PAD_BOTTOM, PULLTAB_H,
  DM_TAB_BESIDE_TITLE, TITLE_HALF_W, PULLTAB_HALF_W, SORT_PILL_W, HEAD_PAD_X, threadStripHeight, threadStripCss,
} from '../src/ui/threadStrip.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const rule = (sel: string) => new RegExp(`${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
const px = (block: string, prop: string) => {
  const m = new RegExp(`(?:^|[;\\s])${prop}:\\s*(\\d+)px`).exec(block)
  return m ? Number(m[1]) : NaN
}

console.log('== every part of the strip is one number in two files, and they agree (D-tc01)')
const card = rule('.tc-carousel-card')
const head = rule('.tc-carousel-head')
const track = rule('.tc-carousel-track')
const tab = /\.tc-pulltab\[data-pull='down'\], \.tc-pulltab\[data-pull='up'\] \{([^}]*)\}/.exec(css)?.[1] ?? ''
check(`card height ${THREAD_CARD_H}px in the CSS`, px(card, 'height') === THREAD_CARD_H, px(card, 'height'))
check('and it is the WHOLE card (border-box), or the sum is 2px short', /box-sizing:\s*border-box/.test(card))
check(`header height ${THREAD_HEAD_H}px in the CSS`, px(head, 'height') === THREAD_HEAD_H, px(head, 'height'))
check('and it is border-box too', /box-sizing:\s*border-box/.test(head))
check('the header states its line-height, so the root 145% cannot grow it',
  /line-height:\s*\d+px/.test(head), head)
{
  const m = /padding:\s*(\d+)px 0 (\d+)px/.exec(track)
  check('the track pads top and bottom and NOTHING sideways (trackOffset owns x)', !!m, track)
  check(`top ${THREAD_TRACK_PAD_TOP}px and bottom ${THREAD_TRACK_PAD_BOTTOM}px, as the module says`,
    !!m && Number(m[1]) === THREAD_TRACK_PAD_TOP && Number(m[2]) === THREAD_TRACK_PAD_BOTTOM, m?.slice(1))
  check('border-box, so the padding is inside the track and not added to the strip',
    /box-sizing:\s*border-box/.test(track))
}
check(`the pull tab is ${PULLTAB_H}px, as the module says`, px(tab, 'height') === PULLTAB_H, px(tab, 'height'))

console.log('== the height is the sum of its parts, with no surplus to become dead space')
check('it is header + pad + card + pad',
  threadStripHeight() === THREAD_HEAD_H + THREAD_TRACK_PAD_TOP + THREAD_CARD_H + THREAD_TRACK_PAD_BOTTOM)
check('the air around the card is small -- under 30px in total',
  THREAD_TRACK_PAD_TOP + THREAD_TRACK_PAD_BOTTOM < 30, THREAD_TRACK_PAD_TOP + THREAD_TRACK_PAD_BOTTOM)
check('the Hide-threads tab has its own lane below the card, with clearance',
  THREAD_TRACK_PAD_BOTTOM >= PULLTAB_H + 4, [THREAD_TRACK_PAD_BOTTOM, PULLTAB_H])
check('the CSS value is that number in px, not a share of the layout',
  threadStripCss() === `${threadStripHeight()}px`, threadStripCss())

console.log('== the tile and the tab take the SAME expression')
// They are one edge. Two expressions of it drift, which is the shape of bug
// dmStrip.ts exists to end.
check('one value is computed', /const threadStripH = threadStripCss\(\)/.test(app))
check('the tile uses it', /height: threadListReveal\.shown \? threadStripH : 0/.test(app))
check('the tab uses it', new RegExp(`top: threadStripH, marginTop: -${PULLTAB_H}`).test(app))
check('no share of the layout survives in App to be reached for',
  !/threadsShareOfChatColumn|threadsShare\b/.test(app))

console.log('== the DM tab rides the strip, in the strip\'s coordinates, in the free lane')
{
  // Evaluate the CSS expression at real strip widths and check what it lands
  // on. Widths: a wide screen, 1440 with a thread open (598), and the narrow
  // end where the title hides (<= 390) and the chat column's floor (320).
  const m = /^min\(calc\(50% \+ (\d+)px\), calc\(100% - (\d+)px\)\)$/.exec(DM_TAB_BESIDE_TITLE)
  check('the tab position is min(right of the title, left of the sort pill)', !!m, DM_TAB_BESIDE_TITLE)
  const right = m ? Number(m[1]) : 0
  const fromEnd = m ? Number(m[2]) : 0
  check('right of the title by at least a gap', right - PULLTAB_HALF_W >= TITLE_HALF_W + 8, right)
  // The container is the header's content box: the strip less its padding.
  const capMax = Number(/@container tc-threadlist-head \(max-width: (\d+)px\) \{\s*\.tc-threadlist-caption/.exec(css)?.[1] ?? NaN)
  const titleMax = Number(/@container tc-threadlist-head \(max-width: (\d+)px\) \{\s*\.tc-threadlist-title/.exec(css)?.[1] ?? NaN)
  for (const W of [1048, 700, 598, 582, 480, 440, 431, 420, 360, 320]) {
    const c = Math.min(W / 2 + right, W - fromEnd)
    const tab: [number, number] = [c - PULLTAB_HALF_W, c + PULLTAB_HALF_W]
    const inner = W - 2 * HEAD_PAD_X
    const captions = inner > capMax
    const titleShown = inner > titleMax
    const title: [number, number] = [W / 2 - TITLE_HALF_W, W / 2 + TITLE_HALF_W]
    const left: [number, number] = [HEAD_PAD_X, HEAD_PAD_X + 127 + (captions ? 80 : 0)]
    const sort: [number, number] = [W - HEAD_PAD_X - SORT_PILL_W - (captions ? 50 : 0), W - HEAD_PAD_X]
    const hit = (x: [number, number], y: [number, number]) => x[0] < y[1] && y[0] < x[1]
    check(`at ${W}px it touches neither the title, the scope pills nor the sort`,
      !(titleShown && hit(tab, title)) && !hit(tab, left) && !hit(tab, sort),
      { tab, title: titleShown ? title : 'hidden', left, sort })
  }
  check('App places it on the strip only while the strip is on screen (closing included)',
    /const dmTabOnStrip = !!\(dockRoom && !space\.leaves\.dock\.open && selectedRoom && threadListReveal\.mounted\)/.test(app))
  check('and there, in the chat column rather than in <main>',
    /\{dockRoom && dmTabOnStrip && \(\s*\n\s*<PullTab pull="down" target="dock"[^\n]*left: DM_TAB_BESIDE_TITLE/.test(app))
  check('and never both at once', /\{dockRoom && !space\.leaves\.dock\.open && !dmTabOnStrip && \(/.test(app))
}

console.log('== the strip is not a scroll container, and the header keeps its columns')
{
  const carousel = rule('.tc-carousel')
  check('overflow: clip, so focusing a control off to the side cannot scroll the strip',
    /overflow:\s*clip/.test(carousel), carousel)
  const titleRule = rule('.tc-threadlist-title')
  check('the title names column 2', /grid-column:\s*2/.test(titleRule), titleRule)
  check('the sides name columns 1 and 3',
    /\[data-side='left'\] \{ grid-column: 1;/.test(css) && /\[data-side='right'\] \{ grid-column: 3;/.test(css))
  const cap = /@container tc-threadlist-head \(max-width: (\d+)px\) \{\s*\.tc-threadlist-caption/.exec(css)
  const tit = /@container tc-threadlist-head \(max-width: (\d+)px\) \{\s*\.tc-threadlist-title/.exec(css)
  check('captions go first, the title only when the controls alone no longer fit beside it',
    !!cap && !!tit && Number(cap[1]) > Number(tit[1]) && Number(tit[1]) + 2 * 10 >= 2 * 127 + 110 + 24, [cap?.[1], tit?.[1]])
}

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nthread strip: all checks passed')
