// Measures the DM strip's faces in a real layout engine.
//
// Not part of the gate: playwright is not a technetium dependency and the gate
// must run anywhere. This is the one-off that answers the question the pure
// check cannot -- what the browser ACTUALLY lays out. The reported bugs were
// "faces at different heights" and "the glow is an oval", both of which are
// facts about layout, not about source.
//
// It imports the REAL dmFaceStyle from the app, so it cannot pass against a
// copy that has drifted from what ships.
import { chromium } from '/home/saber/fourier-sampling/node_modules/playwright/index.mjs'
import { dmFaceStyle, DM_AVATAR, DM_TILE } from '/home/saber/technetium/src/ui/dmStrip.ts'

const css = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${typeof v === 'number' ? v + 'px' : v}`)
    .join(';')

// Three faces that exercise the difference that used to break alignment:
// a loaded image, a bare initial, and an unread face carrying the glow.
const faces = [
  { id: 'img', state: { ping: false, unread: false }, kind: 'image' },
  { id: 'letter', state: { ping: false, unread: false }, kind: 'initial' },
  { id: 'glow', state: { ping: false, unread: true }, kind: 'initial' },
  { id: 'ping', state: { ping: true, unread: true }, kind: 'image' },
]

const iconCss = `width:${DM_AVATAR}px;height:${DM_AVATAR}px;border-radius:50%;overflow:hidden;display:grid;place-items:center;font-size:${Math.round(DM_AVATAR * 0.62)}px;line-height:1;background:#333;color:#ccc`
// A 1x1 gif stretched to fill, standing in for an avatar. The point is that an
// <img> is replaced content with a baseline, which is what used to push its
// row taller than the letter faces.
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='

const html = `<!doctype html><html><body style="margin:0;background:#111">
<div id="row" style="display:flex;flex-wrap:wrap;align-items:center;gap:13px;padding:10px 12px 12px">
${faces
  .map(
    (f) => `<button id="${f.id}" style="${css(dmFaceStyle(f.state))}">
      <span style="${iconCss}">${
        f.kind === 'image'
          ? `<img src="${GIF}" style="width:100%;height:100%;object-fit:cover" alt="">`
          : 'B'
      }</span>
    </button>`,
  )
  .join('\n')}
</div></body></html>`

const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent(html)
await page.waitForTimeout(120)

const measured = await page.evaluate(
  (ids) =>
    ids.map((id) => {
      const el = document.getElementById(id)
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        id,
        w: Math.round(r.width * 100) / 100,
        h: Math.round(r.height * 100) / 100,
        centerY: Math.round((r.top + r.height / 2) * 100) / 100,
        radius: cs.borderRadius,
        boxSizing: cs.boxSizing,
      }
    }),
  faces.map((f) => f.id),
)
await browser.close()

let failures = 0
const check = (name, cond, extra) => {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, JSON.stringify(extra ?? '')) }
}

console.log('measured:', JSON.stringify(measured, null, 1), '\n')

for (const m of measured) {
  check(`${m.id}: is exactly ${DM_TILE}x${DM_TILE}`, m.w === DM_TILE && m.h === DM_TILE, m)
  check(`${m.id}: is square, so the ring is a circle not an oval`, m.w === m.h, m)
  check(`${m.id}: border-box, so the ring sits inside the tile`, m.boxSizing === 'border-box', m)
}
const centers = [...new Set(measured.map((m) => m.centerY))]
check(
  'every face shares one vertical centre, image and initial alike',
  centers.length === 1,
  { centers, measured },
)

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nall ok')
