// Evaluate one expression in the tablet's spike.html tab over CDP (adb forward tcp:9222).
// Usage: node cdp.mjs "<expression>" [timeout s]   or   node cdp.mjs @file.js [timeout s]
import { readFileSync } from 'node:fs'
const arg = process.argv[2] || "document.getElementById('out').value"
const expr = arg.startsWith('@') ? readFileSync(arg.slice(1), 'utf8') : arg
const tabs = await (await fetch('http://127.0.0.1:9222/json')).json()
const tab = tabs.find(t => t.type === 'page' && /localhost:5199\/spike\.html/.test(t.url))
if (!tab) { console.log('FAIL: no spike.html tab open on the tablet. fix: open http://localhost:5199/spike.html in Chrome there. tabs: ' + tabs.map(t => t.url).join(' | ')); process.exit(1) }
const ws = new WebSocket(tab.webSocketDebuggerUrl)
ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }))
ws.onmessage = (m) => { const r = JSON.parse(m.data); if (r.id !== 1) return; const v = r.result && r.result.result; console.log(r.error ? 'FAIL: ' + JSON.stringify(r.error) : (r.result.exceptionDetails ? 'EXCEPTION: ' + JSON.stringify(r.result.exceptionDetails) : (typeof v.value === 'string' ? v.value : JSON.stringify(v.value)))); ws.close(); process.exit(0) }
ws.onerror = (e) => { console.log('FAIL: websocket: ' + e.message); process.exit(1) }
const lim = +(process.argv[3] || 15); setTimeout(() => { console.log('FAIL: no answer in ' + lim + ' s'); process.exit(1) }, lim * 1000)
