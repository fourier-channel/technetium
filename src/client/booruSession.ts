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
