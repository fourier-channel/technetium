// Measures the pull tabs' press areas on a phone (pulltabs-touch.html) in
// headless Chromium over CDP: under a mouse, then under touch emulation
// (pointer: coarse). Run by pulltabs-touch.sh; exits 1 on any miss.
// What it proves: the stylesheet's press areas for this markup. Not that App
// emits this markup, and not a real thumb on a real phone.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const [shell, url, png] = process.argv.slice(2)
const profile = mkdtempSync(join(tmpdir(), 'tc-tabs-'))
const chrome = spawn(shell, ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--window-size=390,700', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
const portFile = join(profile, 'DevToolsActivePort')
for (let i = 0; i < 100 && !existsSync(portFile); i++) await new Promise((r) => setTimeout(r, 100))
const port = readFileSync(portFile, 'utf8').split('\n')[0]
const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r))
let id = 0; const pending = new Map()
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result.result.value
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0; const expect = (n, ok, got) => { console.log((ok ? '  ok   ' : '  FAIL ') + n + (got !== undefined ? '  ' + got : '')); if (!ok) fails++ }
// What a press at (x, y) lands on, by id.
const at = (x, y) => ev(`(document.elementFromPoint(${x}, ${y})?.closest('[id]')?.id) || 'none'`)
const mid = async (sel) => ev(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return [r.left, r.right, r.top + r.height / 2, r.width] })()`)

for (const mode of ['mouse', 'touch']) {
  if (mode === 'touch') await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 700, deviceScaleFactor: 1, mobile: mode === 'touch' })
  await send('Page.navigate', { url }); await sleep(800)
  const coarse = await ev(`matchMedia('(pointer: coarse)').matches`)
  console.log(`== ${mode} (pointer: coarse = ${coarse})`)
  const [, , ry, rw] = await mid('#rooms'); const [ml, , my, mw] = await mid('#members')
  console.log(`   drawn: Rooms ${rw}px wide, Members ${mw}px wide`)
  const rooms20 = await at(20, ry), rooms40 = await at(40, ry), rooms50 = await at(50, ry)
  const mem20 = await at(390 - 20, my), mem40 = await at(390 - 40, my)
  if (mode === 'mouse') {
    expect('a mouse keeps the 16px tab', coarse === false && rw === 16, rw)
    expect('and presses only on it: 20px in is the chat', rooms20 === 'chat', rooms20)
  } else {
    expect('touch draws the tab 24px wide', coarse === true && rw === 24 && mw === 24, `${rw} ${mw}`)
    expect('a thumb 20px in from the left edge hits Rooms', rooms20 === 'rooms', rooms20)
    expect('and 40px in', rooms40 === 'rooms', rooms40)
    expect('but 50px in is the chat (the area is 44px)', rooms50 === 'chat', rooms50)
    expect('a thumb 20px and 40px in from the right edge hits Members', mem20 === 'members' && mem40 === 'members', `${mem20} ${mem40}`)
    const between = await at(390 - 20, (my + (await mid('#thread'))[2]) / 2)
    expect('halfway between Members and the thread tab is neither', between === 'chat', between)
    if (png) { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(png, Buffer.from(s.result.data, 'base64')) }
  }
}
chrome.kill(); rmSync(profile, { recursive: true, force: true }); process.exit(fails ? 1 : 0)
