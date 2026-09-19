// The write has to stay a CORS-SIMPLE request, and that is not a style rule --
// it is the whole reason the write works at all.
//
// Measured against production on 2026-09-19: OPTIONS to a booru post through
// Caddy, with no cookie, answers 403 with no CORS headers. A preflight carries
// no cookies by specification, so anything that triggers one can never be
// sent. A PUT triggers one. A custom header triggers one. This check fails the
// build if either creeps back in, because the symptom is a "NetworkError" in
// one browser and nothing in any test.
import { csrfTokenFrom, resetBooruCsrf } from '../src/client/booruCsrf'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

// CORS-safelisted request headers. Anything outside this set forces a
// preflight; Content-Type additionally restricts its VALUE to three.
const SAFELISTED = new Set(['accept', 'accept-language', 'content-language', 'content-type'])
const SIMPLE_CONTENT_TYPES = new Set([
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
])
const SIMPLE_METHODS = new Set(['GET', 'HEAD', 'POST'])

interface Sent { url: string; init: RequestInit }

// The token page must answer with a page, not with the JSON the write gets --
// the first version of this returned the same object to both, so the token was
// silently null and the write went out without one. That is exactly the
// failure the check exists to catch, and it caught it about itself.
const TOKEN_PAGE_HTML =
  '<html><head><meta name="csrf-param" content="authenticity_token" />' +
  '<meta name="csrf-token" content="TESTTOKEN123" /></head></html>'

function recorder(status = 200, body: unknown = { id: 4, tag_string: 'a b' }) {
  const sent: Sent[] = []
  const impl = (async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    sent.push({ url: u, init: init ?? {} })
    const isTokenPage = u.includes('/static/site_map')
    return {
      ok: isTokenPage ? true : status >= 200 && status < 300,
      status: isTokenPage ? 200 : status,
      json: async () => body,
      text: async () => TOKEN_PAGE_HTML,
    } as unknown as Response
  }) as unknown as typeof fetch
  return { sent, impl }
}

function assertSimple(label: string, s: Sent) {
  const method = (s.init.method ?? 'GET').toUpperCase()
  check(`${label}: method is simple (${method})`, SIMPLE_METHODS.has(method), method)
  const headers = (s.init.headers ?? {}) as Record<string, string>
  for (const name of Object.keys(headers)) {
    check(`${label}: header "${name}" is safelisted`, SAFELISTED.has(name.toLowerCase()), name)
  }
  const ct = Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1]
  if (ct !== undefined) {
    check(`${label}: content-type is one of the three simple ones`,
      SIMPLE_CONTENT_TYPES.has(ct.split(';')[0].trim().toLowerCase()), ct)
  }
  check(`${label}: credentials are sent, so the booru knows who this is`,
    s.init.credentials === 'include', s.init.credentials)
}

console.log('== the csrf token is read out of a real page head')
{
  // Shaped like Rails' own output, attributes in the order Rails emits them.
  const head = '<meta name="csrf-param" content="authenticity_token" />\n' +
               '<meta name="csrf-token" content="VvT5VYEilQuUmK0GLA8XrIsHXLdAcu==" />'
  check('the token is found', csrfTokenFrom(head) === 'VvT5VYEilQuUmK0GLA8XrIsHXLdAcu==')
  check('csrf-param is not mistaken for it', csrfTokenFrom(head) !== 'authenticity_token')
  check('single quotes are accepted too',
    csrfTokenFrom("<meta name='csrf-token' content='abc'>") === 'abc')
  check('a page without one says so', csrfTokenFrom('<html><head></head></html>') === null)
  check('a page that only mentions the words is not a token',
    csrfTokenFrom('<p>csrf-token</p>') === null)
}

console.log('== the write is a simple request')
{
  resetBooruCsrf()
  const m = await import('../src/client/booruTags')
  const { sent, impl: _impl } = await (async () => {
    const rec = recorder()
    await m.writeBooruTags(4, 'old_a old_b', { add: ['fresh'] }, rec.impl)
    return rec
  })()
  void _impl
  // The token fetch, then the write.
  check('two requests: the token page, then the write', sent.length === 2, sent.map((s) => s.url))
  const write = sent[sent.length - 1]
  assertSimple('write', write)
  const body = String(write.init.body ?? '')
  check('the verb rides in the body as _method=put', body.includes('_method=put'), body)
  check('old_tag_string is sent, so the edit is a delta',
    body.includes('post%5Bold_tag_string%5D=old_a+old_b'), body)
  check('the new tag string is sent', body.includes('fresh'), body)
  check('the csrf token rides in the BODY, never as a header',
    body.includes('authenticity_token=TESTTOKEN123'), body)
  const headerNames = Object.keys((write.init.headers ?? {}) as Record<string, string>)
  check('no X-CSRF-Token header -- that alone would force a preflight',
    !headerNames.some((h) => h.toLowerCase() === 'x-csrf-token'), headerNames)
}

console.log('== the read is a simple request too')
{
  const m = await import('../src/client/booruTags')
  const rec = recorder()
  await m.fetchBooruTags(4, rec.impl)
  check('one request', rec.sent.length === 1)
  assertSimple('read', rec.sent[0])
}

console.log('== an edit that changes nothing is not sent')
{
  const m = await import('../src/client/booruTags')
  const rec = recorder()
  const out = await m.writeBooruTags(4, 'a b', { add: ['a'] }, rec.impl)
  check('no request at all', rec.sent.length === 0, rec.sent.map((s) => s.url))
  check('and it reports nothing to say', out === null)
}

console.log('== with no token obtainable, nothing doomed is sent')
{
  resetBooruCsrf()
  const m = await import('../src/client/booruTags')
  const sent: string[] = []
  const impl = (async (url: unknown) => {
    sent.push(String(url))
    // The token page answers, but with a page that has no token in it.
    return { ok: true, status: 200, text: async () => '<html></html>', json: async () => ({}) } as unknown as Response
  }) as unknown as typeof fetch
  let msg = ''
  try {
    await m.writeBooruTags(4, 'a', { add: ['b'] }, impl)
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e)
  }
  check('the write is never attempted', sent.length === 1, sent)
  check('and the error names the remedy', /booru session/.test(msg), msg)
}

console.log('== a refused read is a FAULT, not an absence')
{
  const m = await import('../src/client/booruTags')
  // The exact shape that hid the CORS breakage: the booru answers, but
  // refuses. Returning null here made "refused" and "untagged" identical.
  const refusing = (async () => ({
    ok: false, status: 403, json: async () => ({}), text: async () => '',
  })) as unknown as typeof fetch
  let msg = ''
  try {
    await m.fetchBooruTags(4, refusing)
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e)
  }
  check('a 403 throws rather than reading as no tags', msg !== '', msg)
  check('and the message names the credentialed-CORS cause',
    /Allow-Credentials|wildcard/.test(msg), msg)

  const absent = (async () => ({
    ok: false, status: 404, json: async () => ({}), text: async () => '',
  })) as unknown as typeof fetch
  const gone = await m.fetchBooruTags(4, absent)
  check('a 404 is still an answer, not a fault', gone === null)
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
