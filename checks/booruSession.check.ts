// Checks for the zero-click booru session: one exchange per token, the cookie
// request shape, and that failure is remembered rather than retried per mount.
import { ensureBooruSession, resetBooruSession } from '../src/client/booruSession'

let failures = 0
const check = (name: string, cond: boolean, extra?: unknown) => { if (cond) console.log('  ok   ' + name); else { failures++; console.log('  FAIL ' + name + (extra === undefined ? '' : ' -- ' + JSON.stringify(extra))) } }

const calls: { url: string; init: RequestInit }[] = []
const okFetch = async (url: string, init: RequestInit) => { calls.push({ url, init }); return { ok: true } }
const badFetch = async (url: string, init: RequestInit) => { calls.push({ url, init }); return { ok: false } }
const throwingFetch = async (url: string, init: RequestInit) => { calls.push({ url, init }); throw new Error('network') }

async function main() {
  resetBooruSession()
  check('no token -> false without a request', (await ensureBooruSession(null, okFetch, 'https://x/exchange')) === false && calls.length === 0)

  resetBooruSession(); calls.length = 0
  const a = await ensureBooruSession('tok-a', okFetch, 'https://x/exchange')
  check('a token -> POST with credentials and the Bearer header, ok', a === true && calls.length === 1 && calls[0].init.method === 'POST' && calls[0].init.credentials === 'include' && (calls[0].init.headers as Record<string, string>).Authorization === 'Bearer tok-a', calls[0])
  await ensureBooruSession('tok-a', okFetch, 'https://x/exchange'); await ensureBooruSession('tok-a', okFetch, 'https://x/exchange')
  check('the same token is exchanged once, not once per mount', calls.length === 1, calls.length)
  await ensureBooruSession('tok-b', okFetch, 'https://x/exchange')
  check('a new token is exchanged again', calls.length === 2 && (calls[1].init.headers as Record<string, string>).Authorization === 'Bearer tok-b')

  resetBooruSession(); calls.length = 0
  const b = await ensureBooruSession('tok-c', badFetch, 'https://x/exchange')
  await ensureBooruSession('tok-c', badFetch, 'https://x/exchange')
  check('a refused exchange is false and remembered (no retry storm)', b === false && calls.length === 1)

  resetBooruSession(); calls.length = 0
  const c = await ensureBooruSession('tok-d', throwingFetch, 'https://x/exchange')
  check('a network failure is false, never a throw', c === false)

  // 2026-09-28: Firefox users met a burst of CORS errors on every load. The
  // first tag reads went out before the exchange had answered, carried no
  // session cookie, and Cloudflare challenged them (403, no CORS headers).
  // Every booru request in the store now waits on the exchange, and none is
  // sent when it refused. Read from source: the store imports the SDK.
  const { readFileSync } = await import('node:fs')
  const store = readFileSync(new URL('../src/client/useMediaTags.ts', import.meta.url), 'utf8')
  const storeCalls = [...store.matchAll(/\b(fetchBooruPool|writeBooruTags|booruCsrfToken)\(/g)]
  const gated = [...store.matchAll(/withBooruSession\(\(\) => (fetchBooruPool|writeBooruTags)\(/g)]
  check('every booru request in the tag store waits for the session exchange first',
    storeCalls.length > 0 && storeCalls.length === gated.length, { calls: storeCalls.length, gated: gated.length })
  check('and a refused exchange sends nothing, naming the remedy instead',
    /const ok = await ensureBooruSession\(fetchClient\?\.getAccessToken\(\) \?\? null\)\s*\n\s*if \(!ok\) \{\s*\n\s*throw new Error\(/.test(store))

  console.log(failures ? `booruSession: ${failures} FAILED` : 'booruSession: all ok')
  if (failures) process.exit(1)
}
main()
