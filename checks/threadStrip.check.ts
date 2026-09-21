// The thread strip is as tall as what is in it, and no taller.
//
// Reported by the operator 2026-09-21: "The thread LIST view is too tall for
// the cards that occupy it." Its height came from the layout alone -- 0.22 of
// the viewport by default -- while the contents are a fixed 124px card under a
// small header, and the track is flex:1, so every surplus pixel became empty
// space around the card.
//
// space.ts had a pixel FLOOR for the strip and no ceiling, because nothing
// there knew how tall the content was.
import { readFileSync } from 'node:fs'
import {
  THREAD_CARD_H, THREAD_HEAD_H, THREAD_STRIP_PAD, threadStripHeight, threadStripCss,
} from '../src/ui/threadStrip.ts'
import { MIN_PX } from '../src/ui/space.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

console.log('== the card height in the CSS and in the arithmetic are the same number')
// D-tc01 allows a value in two files PROVIDED a check compares them. If these
// drifted the strip would crop its own cards, silently.
const cardRule = /\.tc-carousel-card\s*\{[^}]*?height:\s*(\d+)px/.exec(css)
check('index.css states a card height', !!cardRule, css.slice(0, 0))
check(`and it is ${THREAD_CARD_H}px, as the module says`,
  !!cardRule && Number(cardRule[1]) === THREAD_CARD_H,
  cardRule ? cardRule[1] : 'not found')

console.log('== the height is derived, not typed')
check('it is the sum of its parts',
  threadStripHeight() === THREAD_HEAD_H + THREAD_CARD_H + THREAD_STRIP_PAD)
check('and a card fits inside it with room to spare',
  threadStripHeight() > THREAD_CARD_H && threadStripHeight() - THREAD_CARD_H < 60,
  `${threadStripHeight()} for a ${THREAD_CARD_H} card`)

console.log('== it is a ceiling, and the layout keeps its floor')
check('the strip may never be shorter than a card and its header',
  threadStripHeight() >= MIN_PX.threads.y,
  `natural ${threadStripHeight()} vs floor ${MIN_PX.threads.y}`)
check('a small share stays small -- the cap never makes it TALLER',
  threadStripCss(0.05) === `min(5%, ${threadStripHeight()}px)`)
check('a large share is capped', /^min\(90%, \d+px\)$/.test(threadStripCss(0.9)))

console.log('== the tile and the tab take the SAME expression')
// They are one edge. Capping the tile alone would leave the tab floating
// below it, which is the shape of bug dmStrip.ts exists to end.
check('one value is computed', /const threadStripH = threadStripCss\(threadsShareOfChatColumn\)/.test(app))
check('the tile uses it', /height: threadListReveal\.shown \? threadStripH : 0/.test(app))
check('the tab uses it', /top: threadStripH, marginTop: -12/.test(app))
check('neither re-derives the percentage',
  !/top: `\$\{Math\.round\(threadsShareOfChatColumn/.test(app) &&
  !/height: threadListReveal\.shown \? `\$\{Math\.round/.test(app))

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nthread strip: all checks passed')
