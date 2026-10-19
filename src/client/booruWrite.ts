// Writing to the booru AS THE VIEWER: one implementation for every surface
// that does it -- tag edits (booruTags.ts), BUR decisions (booruBur.ts) and a
// creator's replacement choice (booruReplacement.ts) -- so the shape that
// makes it work cannot drift between them (D-tc01).
//
// THE SHAPE, and why each part is what it is (booruTags.ts and booruCsrf.ts
// tell the full story):
//   - credentials: 'include' -- the viewer's own booru session cookie, so the
//     booru's own permissions apply;
//   - a POST with only CORS-safelisted headers and a form body, never a PUT or
//     DELETE and never a custom header -- anything else is preflighted, a
//     preflight carries no cookie, and the booru's Caddy rule refuses it;
//     the real verb rides as _method;
//   - the CSRF token in the BODY (authenticity_token), fetched once per session;
//   - ONE retry on 422 with a fresh token: a replaced session invalidates the
//     cached one; a second 422 is the booru refusing the write itself.
import { BOORU_ORIGIN } from './booruUrl'
import { booruCsrfToken, resetBooruCsrf } from './booruCsrf'

/** Thrown when no token could be read: the write would be refused. */
export class NoBooruSession extends Error {
  constructor() {
    super(
      'could not read a CSRF token from the booru, so the write would be refused. ' +
        'Fix: this usually means there is no booru session in this browser -- open the booru panel once to sign in there, then try again.',
    )
    this.name = 'NoBooruSession'
  }
}

/**
 * POST `fields` to `path` on the booru as the viewer. `method` rides as
 * _method when it is not POST. Resolves the Response, whatever its status:
 * what a refusal means is the caller's to say.
 */
export async function postAsViewer(
  path: string,
  fields: Record<string, string> | ((csrf: string) => Record<string, string>),
  fetchImpl: typeof fetch = fetch,
  method: 'post' | 'put' | 'delete' = 'post',
): Promise<Response> {
  const send = (csrf: string) => {
    const body = new URLSearchParams(typeof fields === 'function' ? fields(csrf) : { ...fields, authenticity_token: csrf })
    if (method !== 'post') body.set('_method', method)
    return fetchImpl(`${BOORU_ORIGIN}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
  }
  const csrf = await booruCsrfToken(fetchImpl)
  if (!csrf) throw new NoBooruSession()
  let res = await send(csrf)
  if (res.status === 422) {
    resetBooruCsrf()
    const fresh = await booruCsrfToken(fetchImpl)
    if (fresh && fresh !== csrf) res = await send(fresh)
  }
  return res
}

/** GET a booru JSON path as the viewer. Resolves the Response. */
export function getAsViewer(path: string, fetchImpl: typeof fetch = fetch): Promise<Response> {
  return fetchImpl(`${BOORU_ORIGIN}${path}`, { credentials: 'include', headers: { Accept: 'application/json' } })
}
