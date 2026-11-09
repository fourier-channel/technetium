// Zero-click booru session (operator ruling 2026-09-06).
//
// The booru mounted in the dead space gates its pictures on a cookie that
// fourier-auth sets, and Technetium's Matrix login never reached it: the user
// had to open a popup and click through MAS consent. tc.41chan.net and
// booru.41chan.net are the same SITE, so a credentialed POST of the Matrix
// access token to the gate's /exchange sets that cookie here, before the
// frame loads. fourier-auth proves the token with Synapse's whoami; nothing
// is trusted as a string.
//
// Memoised per token at module level: the frame mounts and unmounts as rooms
// are selected, and each mount must not cost a round trip. A failed exchange
// is remembered too (the button is the fallback), until the token changes.

const BOORU_EXCHANGE_URL =
  (import.meta.env.VITE_BOORU_EXCHANGE_URL as string | undefined) ?? 'https://booru.41chan.net/fourier/exchange'

type FetchLike = (input: string, init: RequestInit) => Promise<{ ok: boolean }>

let memo: { token: string; promise: Promise<boolean> } | null = null

export function ensureBooruSession(token: string | null, fetchImpl: FetchLike = fetch, url = BOORU_EXCHANGE_URL): Promise<boolean> {
  if (!token) return Promise.resolve(false)
  if (memo && memo.token === token) return memo.promise
  const promise = fetchImpl(url, {
    method: 'POST',
    credentials: 'include',
    headers: { Authorization: `Bearer ${token}` },
  })
    .then((r) => r.ok)
    .catch(() => false)
  memo = { token, promise }
  return promise
}

// For checks and for logout: forget the memo so the next call asks again.
export function resetBooruSession(): void {
  memo = null
}

// The booru's cookie session dies with the token it was exchanged from (five
// minutes, MAS default), and the SDK renews its token only when a request of
// its own is refused. After a sleep, a VPN switch or a dropped network that
// can be minutes after the reader is back: the booru frame is cross-origin, so
// its pictures cannot be retried from here, and every one it asked for in that
// gap was refused. So on return -- the tab shown again, the window focused,
// the network back -- ask whoami at once. A dead token is refused, the SDK
// refreshes it, and persistTokens (tokenRefresher.ts) exchanges the new one
// before the reader clicks anything. A live token costs one whoami, at most
// once a minute.
type Listenable = {
  addEventListener(type: string, fn: () => void): void
  removeEventListener(type: string, fn: () => void): void
}

export const RENEW_ON_RETURN_GAP_MS = 60_000

export function renewOnReturn(
  ask: () => Promise<unknown>,
  {
    win = window as Listenable,
    doc = document as Listenable & { visibilityState: string },
    now = Date.now,
  }: { win?: Listenable; doc?: Listenable & { visibilityState: string }; now?: () => number } = {},
): () => void {
  let last = -Infinity
  const onReturn = () => {
    if (doc.visibilityState !== 'visible') return
    if (now() - last < RENEW_ON_RETURN_GAP_MS) return
    last = now()
    ask().catch(() => {})
  }
  win.addEventListener('focus', onReturn)
  win.addEventListener('online', onReturn)
  doc.addEventListener('visibilitychange', onReturn)
  return () => {
    win.removeEventListener('focus', onReturn)
    win.removeEventListener('online', onReturn)
    doc.removeEventListener('visibilitychange', onReturn)
  }
}
