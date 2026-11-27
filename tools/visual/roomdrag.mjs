// tc.36: drive roomdrag-react.html in a real engine and print what happened.
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
//     node tools/visual/roomdrag.mjs http://127.0.0.1:PORT firefox|chromium
//
// The page must be served by a dev server running THIS tree (vite compiles the
// TSX). playwright-core is not a dependency of this repo; point
// PLAYWRIGHT_CORE at any install whose browsers.json matches a browser under
// ~/.cache/ms-playwright. Exit 0 only when every observation held.
import { createRequire } from 'node:module'
const core = process.env.PLAYWRIGHT_CORE
if (!core) { console.error('set PLAYWRIGHT_CORE to a playwright-core directory (see the header)'); process.exit(2) }
const pw = createRequire(import.meta.url)(core)
const [base, engine = 'firefox'] = process.argv.slice(2)
if (!base) { console.error('usage: roomdrag.mjs <base-url> [firefox|chromium]'); process.exit(2) }

let failures = 0
const check = (name, cond, extra) => {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond || extra === undefined ? '' : ' ' + JSON.stringify(extra)))
  if (!cond) failures++
}

const browser = await pw[engine].launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 500 } })
  page.on('pageerror', (e) => { console.log('  page error: ' + e.message); failures++ })
  await page.goto(`${base}/tools/visual/roomdrag-react.html`)
  await page.waitForSelector('[title="room 29"]')
  console.log(`engine: ${engine} ${browser.version()}`)
  const state = () => page.evaluate(() => ({
    writes: window.__writes, selected: window.__selected,
    scrollTop: document.getElementById('scroller').scrollTop,
    live: document.querySelector('[aria-live="polite"]')?.textContent ?? null,
    focused: document.activeElement?.getAttribute('title') ?? null,
  }))

  // 1. Drag room 02 to the bottom edge of the scroll box and hold it there.
  const box = await page.locator('#scroller').boundingBox()
  const row = await page.locator('[title="room 02"]').boundingBox()
  const x = row.x + row.width / 2
  await page.mouse.move(x, row.y + row.height / 2)
  await page.mouse.down()
  await page.mouse.move(x, row.y + row.height / 2 + 12, { steps: 4 })
  await page.mouse.move(x, box.y + box.height - 3, { steps: 12 })
  await page.waitForTimeout(1500)
  const held = await state()
  check('holding at the bottom edge scrolls the sidebar box', held.scrollTop > 100, held.scrollTop)
  await page.mouse.up()
  await page.waitForTimeout(500)
  const dropped = await state()
  const w1 = dropped.writes.at(-1)
  check('the drop wrote one order', dropped.writes.length === 1, dropped.writes.length)
  check('it wrote the space\'s scope', w1?.scope === '!41', w1?.scope)
  const at = w1?.ids.indexOf('!room02') ?? -1
  check('room 02 landed in a slot that was scrolled out of view', at >= 12, at)
  check('the order holds every room once', w1 && new Set(w1.ids).size === 30 && w1.ids.length === 30)
  check('the drag did not also select the room', dropped.selected.length === 0, dropped.selected)

  // 2. Alt+Up on room 05.
  await page.locator('[title="room 05"]').focus()
  // Stands on its own if the drag wrote nothing, so a broken drag still
  // lets the keyboard half be observed.
  const before = w1?.ids ?? Array.from({ length: 30 }, (_, i) => `!room${String(i).padStart(2, '0')}`)
  const n0 = dropped.writes.length
  await page.keyboard.press('Alt+ArrowUp')
  await page.waitForTimeout(300)
  const k = await state()
  const w2 = k.writes.at(-1)
  const from = before.indexOf('!room05')
  const want = before.filter((id) => id !== '!room05'); want.splice(from - 1, 0, '!room05')
  check('Alt+Up wrote one more order', k.writes.length === n0 + 1, k.writes.length)
  check('Alt+Up moved room 05 up exactly one place', w2?.ids.join() === want.join(), w2?.ids.slice(0, 8))
  check('focus stayed on room 05', k.focused === 'room 05', k.focused)
  check('the move was spoken', k.live === `Moved room 05 to position ${from} of 30.`, k.live)
  await page.keyboard.press('Alt+ArrowDown')
  await page.waitForTimeout(300)
  const k2 = await state()
  check('Alt+Down moved it back', k2.writes.at(-1)?.ids.join() === before.join())

  // 3. The first room cannot go up; nothing is written, and it says so.
  const firstId = before[0]
  const firstName = 'room ' + firstId.slice(5)
  await page.locator(`[title="${firstName}"]`).focus()
  await page.keyboard.press('Alt+ArrowUp')
  await page.waitForTimeout(300)
  const k3 = await state()
  check('Alt+Up on the first room writes nothing', k3.writes.length === n0 + 2, k3.writes.length)
  check('and says it is already first', k3.live === `${firstName} is already first.`, k3.live)

  // 4. Enter still opens the focused room; a plain arrow does not reorder.
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  const k4 = await state()
  check('Enter selects the focused room', k4.selected.at(-1) === firstId, k4.selected)
  check('a plain arrow wrote no order', k4.writes.length === n0 + 2, k4.writes.length)
} finally {
  await browser.close()
}
console.log(failures === 0 ? 'ALL OBSERVATIONS HELD' : `${failures} OBSERVATION(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
