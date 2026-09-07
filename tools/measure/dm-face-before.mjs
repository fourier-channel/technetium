// CONTROL: the geometry as it shipped, to prove the measurement above would
// have caught the reported bugs. Reproduces the pre-fix markup exactly --
// no explicit button size, no align-items, and the reveal wrapper at its
// default 20 while the icon inside it is 30.
import { chromium } from '/home/saber/fourier-sampling/node_modules/playwright/index.mjs'

const OLD_REVEAL = 20   // EpicycleReveal's default `size`
const OLD_ICON = 30     // what RoomIcon was actually passed
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='

const oldButton = 'padding:0;border:none;background:transparent;cursor:pointer;line-height:0;border-radius:50%;box-shadow:0 0 0 2px orange, 0 0 9px rgba(255,150,40,0.45)'
const iconCss = `width:${OLD_ICON}px;height:${OLD_ICON}px;border-radius:50%;overflow:hidden;display:grid;place-items:center;font-size:19px;line-height:1;background:#333;color:#ccc`
// .epi from NavTree: inline-grid at the wrapper's `size`.
const epi = `position:relative;display:inline-grid;place-items:center;width:${OLD_REVEAL}px;height:${OLD_REVEAL}px;flex-shrink:0`

const html = `<!doctype html><html><body style="margin:0;background:#111">
<div id="row" style="display:flex;flex-wrap:wrap;gap:13px;padding:8px 10px 4px">
  <button id="img" style="${oldButton}"><span style="${epi}"><span style="${iconCss}"><img src="${GIF}" style="width:100%;height:100%;object-fit:cover" alt=""></span></span></button>
  <button id="letter" style="${oldButton}"><span style="${epi}"><span style="${iconCss}">B</span></span></button>
  <button id="noreveal" style="${oldButton}"><span style="${iconCss}">M</span></button>
</div></body></html>`

const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent(html)
await page.waitForTimeout(120)
const measured = await page.evaluate(() =>
  ['img', 'letter', 'noreveal'].map((id) => {
    const r = document.getElementById(id).getBoundingClientRect()
    return {
      id,
      w: Math.round(r.width * 100) / 100,
      h: Math.round(r.height * 100) / 100,
      centerY: Math.round((r.top + r.height / 2) * 100) / 100,
    }
  }),
)
await browser.close()

console.log('measured (OLD):', JSON.stringify(measured, null, 1), '\n')
const square = measured.filter((m) => m.w === m.h)
const centers = [...new Set(measured.map((m) => m.centerY))]
console.log('faces that are square (circle, not oval):', square.length, 'of', measured.length)
console.log('distinct vertical centres:', centers.length, JSON.stringify(centers))
console.log(
  square.length === measured.length && centers.length === 1
    ? '\nCONTROL DID NOT REPRODUCE -- the measurement proves nothing'
    : '\nCONTROL REPRODUCES the reported bugs: the new measurement has teeth',
)
