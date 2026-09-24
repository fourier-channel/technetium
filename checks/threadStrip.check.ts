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
  DM_TAB_BESIDE_TITLE, threadStripHeight, threadStripCss,
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

console.log('== the DM tab steps clear of the centred title while the strip is open')
{
  // The title is centred; the tab is 46px wide and centred on its `left`.
  const m = /calc\(50% - (\d+)px\)/.exec(DM_TAB_BESIDE_TITLE)
  const off = m ? Number(m[1]) : 0
  const TITLE_HALF = 48 // "Thread Listing", 13px semibold, measured in the harness
  check('the tab\'s right edge clears the title\'s left edge', off - 23 >= TITLE_HALF + 8, off)
  check('App uses it only while the strip is open',
    /selectedRoom && threadListOpen \? DM_TAB_BESIDE_TITLE : 'calc\(50% - 40px\)'/.test(app))
}

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nthread strip: all checks passed')
