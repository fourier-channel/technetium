// Renders the DM section as it will look after the change, for eyeballing
// before a deploy. Faces use the REAL dmFaceStyle; the pill and header are
// reproduced from NavTree's inline styles, so treat those as a mock-up.
import { chromium } from '/home/saber/fourier-sampling/node_modules/playwright/index.mjs'
import { dmFaceStyle, DM_AVATAR } from '/home/saber/technetium/src/ui/dmStrip.ts'

const css = (o) =>
  Object.entries(o).filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${typeof v === 'number' ? v + 'px' : v}`)
    .join(';')

const swatch = (c) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="${c}"/><circle cx="30" cy="22" r="11" fill="rgba(255,255,255,.55)"/><ellipse cx="30" cy="52" rx="19" ry="14" fill="rgba(255,255,255,.4)"/></svg>`)}`

const icon = `width:${DM_AVATAR}px;height:${DM_AVATAR}px;border-radius:50%;overflow:hidden;display:grid;place-items:center;font-size:${Math.round(DM_AVATAR*0.62)}px;line-height:1;background:#2b2f36;color:#c9ced6;font-family:Inter,system-ui,sans-serif`

const faces = [
  { img: '#7a5cff' }, { t: 'B' }, { t: 'F' }, { t: 'F' },
  { img: '#3fbf6f', unread: true }, { img: '#d0463b' }, { t: 'M' },
  { img: '#e0574f', ping: true }, { t: 'N' }, { t: 'S' }, { img: '#57c9c1' }, { t: 'K' },
]

const face = (f) => `<button style="${css(dmFaceStyle({ ping: !!f.ping, unread: !!f.unread }))}">
  <span style="${icon}">${f.img ? `<img src="${swatch(f.img)}" style="width:100%;height:100%;object-fit:cover">` : f.t}</span>
</button>`

const pill = (open) => `
<div style="margin:2px 4px 6px;border:1px solid rgba(128,128,128,0.3);border-radius:14px;background:${open ? 'rgba(255,255,255,0.055)' : 'transparent'}">
  <div style="display:flex;align-items:center;gap:6px;width:100%;padding:4px 10px;border-radius:0;border:none;background:transparent;color:#9aa3ad;font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;font-family:Inter,system-ui,sans-serif;box-sizing:border-box">
    <span style="font-size:9px;opacity:.7">${open ? '▾' : '▸'}</span>Direct Messages
    <span style="margin-left:auto;opacity:.7">16</span>
  </div>
  ${open ? `<div style="display:block;margin:4px 0 0 10px;padding:2px 9px;border-radius:999px;border:1px solid rgba(128,128,128,0.35);color:#9aa3ad;font-size:10px;letter-spacing:.4px;text-transform:uppercase;width:max-content;font-family:Inter,system-ui,sans-serif">Recent</div>
  <div style="display:flex;flex-wrap:wrap;align-items:center;gap:13px;padding:10px 12px 12px">${faces.map(face).join('')}</div>` : ''}
</div>`

// The glow is written in terms of the app's unread tokens. Without them the
// whole box-shadow declaration is invalid and renders as NOTHING -- which is
// exactly what the first version of this preview did, silently. Values copied
// from src/index.css.
const html = `<!doctype html><html><head><style>
:root { --tc-unread: #ff9a3c; --tc-unread-base: #e8913f; }
@keyframes tcDmPulse {
  0%, 100% { box-shadow: 0 0 0 2px var(--tc-unread-base), 0 0 7px 1px rgba(255,150,40,0.3); }
  50% { box-shadow: 0 0 0 2px var(--tc-unread), 0 0 16px 4px rgba(255,150,40,0.8); }
}
</style></head><body style="margin:0;background:#15181d;width:300px;padding:14px 0">
<div style="width:272px">
  <div style="color:#5d666f;font:600 10px Inter,system-ui,sans-serif;letter-spacing:.5px;padding:0 6px 6px">EXPANDED</div>
  ${pill(true)}
  <div style="color:#5d666f;font:600 10px Inter,system-ui,sans-serif;letter-spacing:.5px;padding:12px 6px 6px">COLLAPSED</div>
  ${pill(false)}
</div></body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 300, height: 340 }, deviceScaleFactor: 2 })
await page.setContent(html)
await page.waitForTimeout(200)
await page.screenshot({ path: process.argv[2] })
await browser.close()
console.log('wrote', process.argv[2])
