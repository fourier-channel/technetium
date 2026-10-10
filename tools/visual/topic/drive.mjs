// Drives the REAL RoomHeaderInfo (topic line, full-topic popup, pencil, editor)
// around a stand-in room and client (main.tsx) in headless Chromium over CDP.
// Run by run.sh; exits 1 on any miss. It proves the component's behaviour
// against a fake room; not a save against a live homeserver.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const [shell, url, png] = process.argv.slice(2)
const profile = mkdtempSync(join(tmpdir(), 'tc-topic-'))
const chrome = spawn(shell, ['--no-sandbox', '--disable-gpu', '--window-size=700,600', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
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
let fails = 0; const expect = (n, ok, got) => { console.log((ok ? '  ok   ' : '  FAIL ') + n + (got !== undefined ? '  ' + JSON.stringify(got) : '')); if (!ok) fails++ }
const center = (sel) => ev(`(() => { const r = document.querySelector('${sel}')?.getBoundingClientRect(); return r ? [r.x + r.width / 2, r.y + r.height / 2] : null })()`)
const click = async (x, y) => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }) }
const clickSel = async (sel) => { const c = await center(sel); if (!c) return false; await click(c[0], c[1]); return true }
const text = (sel) => ev(`document.querySelector('${sel}')?.innerText ?? null`)

await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }); await send('Page.navigate', { url }); await sleep(1200)
expect('the header shows the topic on one line', (await text('.tc-room-header-topic')) === 'Rules: 1. Be kind 2. No spam', await text('.tc-room-header-topic'))
expect('and a pencil for someone who may change it', (await ev(`document.querySelector('.tc-room-header-edit')?.getAttribute('aria-label')`)) === 'Edit the room topic')

await clickSel('.tc-room-header-topic'); await sleep(400)
expect('a click on the topic shows the whole of it, line breaks kept', (await text('.tc-topic-full')) === 'Rules:\n1. Be kind\n2. No spam', await text('.tc-topic-full'))
await click(680, 580); await sleep(300)
expect('a press outside closes it', (await text('.tc-topic-full')) === null)

await clickSel('.tc-room-header-edit'); await sleep(400)
expect('the pencil opens the editor with the topic as written', (await ev(`document.querySelector('.tc-topic-editor-text')?.value`)) === 'Rules:\n1. Be kind\n2. No spam')
expect('Save is off until something changes', (await ev(`document.querySelector('.tc-topic-editor-save').disabled`)) === true)
await ev(`document.querySelector('.tc-topic-editor-text').focus(); document.querySelector('.tc-topic-editor-text').setSelectionRange(9999, 9999)`)
await send('Input.insertText', { text: '\n3. Tag your posts' }); await sleep(100)
await clickSel('.tc-topic-editor-save'); await sleep(60)
expect('Save shows that it is saving', (await ev(`document.querySelector('.tc-topic-editor-save').textContent`)) === 'Saving...')
await sleep(500)
expect('the server got the new topic', (await ev('JSON.stringify(window.saves)')) === JSON.stringify(['Rules:\n1. Be kind\n2. No spam\n3. Tag your posts']), await ev('window.saves'))
expect('the editor closed and the header redrew from the state', (await text('.tc-topic-editor-text')) === null && (await text('.tc-room-header-topic')) === 'Rules: 1. Be kind 2. No spam 3. Tag your posts', await text('.tc-room-header-topic'))

await ev('window.fail = true')
await clickSel('.tc-room-header-edit'); await sleep(400)
await ev(`document.querySelector('.tc-topic-editor-text').focus(); document.querySelector('.tc-topic-editor-text').setSelectionRange(9999, 9999)`)
await send('Input.insertText', { text: '\n4. Draft' }); await sleep(100)
await clickSel('.tc-topic-editor-save'); await sleep(600)
expect('a refused save says why and who to ask', /ask a moderator/.test((await text('.tc-topic-editor-error')) ?? ''), await text('.tc-topic-editor-error'))
expect('and keeps the text', /4\. Draft$/.test(await ev(`document.querySelector('.tc-topic-editor-text').value`)))
await click(680, 580); await sleep(300)
expect('a press outside closes the editor', (await text('.tc-topic-editor-text')) === null)
await clickSel('.tc-room-header-edit'); await sleep(400)
expect('reopening finds the draft as it was left', /4\. Draft$/.test(await ev(`document.querySelector('.tc-topic-editor-text')?.value ?? ''`)))
await ev(`document.querySelector('.tc-topic-editor-text').focus()`)
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(300)
expect('Escape while typing closes the editor', (await text('.tc-topic-editor-text')) === null)
await clickSel('.tc-room-header-edit'); await sleep(400)
expect('and the draft is still there', /4\. Draft$/.test(await ev(`document.querySelector('.tc-topic-editor-text')?.value ?? ''`)))
if (png) { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(png, Buffer.from(s.result.data, 'base64')) }
await clickSel('.tc-pill:not(.tc-topic-editor-save)'); await sleep(300)
await clickSel('.tc-room-header-edit'); await sleep(400)
expect('Cancel drops the draft', (await ev(`document.querySelector('.tc-topic-editor-text')?.value`)) === 'Rules:\n1. Be kind\n2. No spam\n3. Tag your posts')
await clickSel('.tc-pill:not(.tc-topic-editor-save)'); await sleep(300)

await ev('window.may = false; window.emit()'); await sleep(200)
expect('someone whose level does not allow it gets no pencil', (await ev(`!!document.querySelector('.tc-room-header-edit')`)) === false)
await ev('window.may = true; window.topic = ""; window.emit()'); await sleep(200)
expect('a room with no topic offers to add one, and shows no empty topic', (await ev(`document.querySelector('.tc-room-header-edit')?.getAttribute('aria-label')`)) === 'Add a room topic' && (await ev(`!!document.querySelector('.tc-room-header-topic')`)) === false)
await ev('window.topic = "Rules"; window.emit()'); await sleep(200)
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
await send('Page.reload'); await sleep(1200)
const box = await ev(`(() => { const p = document.querySelector('.tc-room-header-edit').getBoundingClientRect(); const i = document.querySelector('.tc-room-header-info').getBoundingClientRect(); const h = document.querySelector('.tc-titlebar').getBoundingClientRect(); return { coarse: matchMedia('(pointer: coarse)').matches, pencil: [p.width, p.height], info: i.height, bar: h.height, hit: document.elementFromPoint(p.right + 3, p.top + p.height / 2)?.className } })()`)
expect('on touch the pencil stays 22px and the row fits the bar', box.coarse && box.pencil[0] === 22 && box.pencil[1] === 22 && box.info <= box.bar, box)
expect('while a press 3px beside it still lands on it', box.hit === 'tc-room-header-edit', box.hit)
chrome.kill(); rmSync(profile, { recursive: true, force: true }); process.exit(fails ? 1 : 0)
