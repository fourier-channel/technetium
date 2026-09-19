// Rails' authenticity token, for writing to the booru as the signed-in person.
//
// WHY THIS IS NEEDED AT ALL. Danbooru turns CSRF protection off only for
// API-KEY authentication (`skip_forgery_protection if has_api_authentication?`).
// Technetium deliberately writes as the VIEWER, using the booru session cookie
// fourier-auth already set -- that is what makes the booru's own permissions,
// bans and post history apply for free -- so the forgery check is live and a
// write without a token is refused.
//
// The alternative was sending the user's API key, which would have to travel in
// the query string to stay a CORS-simple request. A credential in a URL lands
// in every access log on the path. Not that.
//
// WHERE THE TOKEN COMES FROM. Any booru HTML page carries it in
// <meta name="csrf-token">. That is readable cross-origin now that the booru
// echoes tc's origin with credentials; before that fix nothing here could work
// at all. /static/site_map is the cheapest page that has one.
//
// IT IS SENT IN THE BODY, not as X-CSRF-Token. Rails accepts either, but a
// custom request header makes the request CORS-NON-SIMPLE, which triggers a
// preflight -- and a preflight carries no cookies, so the booru's Caddy rule
// refuses it with a 403 before any of this is consulted (measured). Everything
// about this path is shaped by staying simple.
//
// MEMOISED, AND INVALIDATED ON REJECTION. Rails masks the token per call but
// every mask validates against the same session, so one fetch serves the
// session. If the session is replaced the cached mask stops validating, which
// is why writeBooruTags drops it and retries once rather than failing forever.
import { BOORU_ORIGIN } from './booruUrl'

const TOKEN_PAGE = '/static/site_map'

let pending: Promise<string | null> | null = null
let token: string | null = null

/** Parse the token out of a page's head. Exported for the check. */
export function csrfTokenFrom(html: string): string | null {
  const m = /<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i.exec(html)
  return m ? m[1] : null
}

export async function booruCsrfToken(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (token !== null) return token
  // One fetch even if ten pills are edited at once.
  if (pending) return pending
  pending = fetchImpl(`${BOORU_ORIGIN}${TOKEN_PAGE}`, {
    credentials: 'include',
    headers: { Accept: 'text/html' },
  })
    .then((r) => (r.ok ? r.text() : null))
    .then((html) => {
      token = html ? csrfTokenFrom(html) : null
      return token
    })
    .catch(() => null)
    .finally(() => {
      pending = null
    })
  return pending
}

/** Forget the token: the session it belonged to is gone or was rejected. */
export function resetBooruCsrf(): void {
  token = null
  pending = null
}
