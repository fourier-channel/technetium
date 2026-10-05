// Drives devicelock.html in headless Chromium over the DevTools protocol and
// prints #result once the page says it is done. --dump-dom cannot do this: it
// fires at the load event, before the page's Web Locks requests (answered by
// the browser process, not by a timer) have settled.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [shell, url] = process.argv.slice(2)
const profile = mkdtempSync(join(tmpdir(), 'tc-devicelock-'))
const chrome = spawn(shell, ['--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
const done = (code, msg) => { if (msg) console.log(msg); chrome.kill(); rmSync(profile, { recursive: true, force: true }); process.exit(code) }
setTimeout(() => done(1, 'TIMED OUT after 20s'), 20000)

const portFile = join(profile, 'DevToolsActivePort')
for (let i = 0; i < 100 && !existsSync(portFile); i++) await new Promise((r) => setTimeout(r, 100))
if (!existsSync(portFile)) done(1, 'chromium did not start')
const port = readFileSync(portFile, 'utf8').split('\n')[0]
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Page.navigate', { url })
for (let i = 0; i < 150; i++) {
  await new Promise((r) => setTimeout(r, 100))
  const r = await send('Runtime.evaluate', { expression: "document.getElementById('result')?.textContent ?? ''", returnByValue: true })
  const text = r.result?.result?.value ?? ''
  if (text && text !== 'running') done(0, text)
}
done(1, 'the page never finished')
