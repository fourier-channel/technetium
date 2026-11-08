// Serves this folder on 127.0.0.1 so spike.html runs on a real http origin
// (localhost is a secure context and keeps per-origin grants the way the
// deployed client's origin does; file:// does not). Loopback only, read only,
// this folder only. Run: node serve.mjs   Stop: Ctrl+C
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const port = 5199
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' }
const server = createServer(async (req, res) => {
  const name = path.basename(decodeURIComponent(new URL(req.url, 'http://x').pathname)) || 'spike.html'
  const type = types[path.extname(name)]
  if (!type) { res.writeHead(404).end('not served: ' + name); return }
  try { const body = await readFile(path.join(dir, name)); res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }).end(body) }
  catch { res.writeHead(404).end('not found: ' + name) }
})
server.on('error', (e) => { console.log('FAIL: could not serve on port ' + port + ': ' + e.message + '. fix: close the other window running serve.mjs, or whatever holds the port'); process.exit(1) })
server.listen(port, '127.0.0.1', () => console.log('PASS: serving http://localhost:' + port + '/spike.html -- leave this window open; Ctrl+C stops it'))
