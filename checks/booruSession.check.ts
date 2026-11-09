// Checks for the zero-click booru session: one exchange per token, the cookie
// request shape, and that failure is remembered rather than retried per mount.
import { ensureBooruSession, renewOnReturn, resetBooruSession, RENEW_ON_RETURN_GAP_MS } from '../src/client/booruSession'

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

  // 2026-11-09: a tester's booru pictures failed after a VPN switch. The
  // frame's cookie died with the five-minute token, and nothing renewed the
  // token until the sync loop was next refused. On return, ask at once.
  {
    const target = () => {
      const fns = new Map<string, Set<() => void>>()
      return {
        visibilityState: 'visible',
        addEventListener: (t: string, f: () => void) => { if (!fns.has(t)) fns.set(t, new Set()); fns.get(t)!.add(f) },
        removeEventListener: (t: string, f: () => void) => { fns.get(t)?.delete(f) },
        fire: (t: string) => { for (const f of fns.get(t) ?? []) f() },
        count: () => [...fns.values()].reduce((n, s) => n + s.size, 0),
      }
    }
    const win = target(), doc = target()
    let clock = 1_000_000, asked = 0
    const stop = renewOnReturn(async () => { asked++ }, { win, doc, now: () => clock })
    doc.fire('visibilitychange')
    check('the tab shown again asks whoami at once', asked === 1, asked)
    win.fire('focus'); win.fire('online')
    check('a burst of return events in one minute asks once', asked === 1, asked)
    clock += RENEW_ON_RETURN_GAP_MS
    win.fire('online')
    check('the network back a minute later asks again', asked === 2, asked)
    clock += RENEW_ON_RETURN_GAP_MS
    win.fire('focus')
    check('the window focused a minute later asks again', asked === 3, asked)
    clock += RENEW_ON_RETURN_GAP_MS
    doc.visibilityState = 'hidden'
    doc.fire('visibilitychange')
    check('the tab being hidden does not ask', asked === 3, asked)
    // An unhandled rejection ends this process, so reaching the check is the proof.
    const fdoc = target()
    let refused = 0
    const failing = renewOnReturn(async () => { refused++; throw new Error('offline') }, { win: target(), doc: fdoc, now: () => clock })
    fdoc.fire('visibilitychange')
    await new Promise((r) => setTimeout(r, 10))
    failing()
    check('a refused ask is swallowed, not thrown out of the listener', refused === 1, refused)
    stop()
    check('stopping removes every listener', win.count() === 0 && doc.count() === 0, [win.count(), doc.count()])
    const ctx = readFileSync(new URL('../src/client/ClientContext.tsx', import.meta.url), 'utf8')
    check('the client context renews on return with whoami, per client',
      /return renewOnReturn\(\(\) => client\.whoami\(\)\)\s*\n\s*\}, \[client\]\)/.test(ctx))
  }

  console.log(failures ? `booruSession: ${failures} FAILED` : 'booruSession: all ok')
  if (failures) process.exit(1)
}
main()
