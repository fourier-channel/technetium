// A creator's replacement after it lands: the card's pointer, what it says
// and offers (only what the booru allows -- the 24 hours are the booru's),
// the write it sends, the remembered dialog choice, and the reload: a
// replaced picture's URL carries its new file version, every other URL is
// untouched.
import {
  oldVersionText,
  parseReplacement,
  replacementOffer,
  replacementPointer,
  setRetention,
  type Replacement,
} from '../src/client/booruReplacement'
import { fileVersionFrom, fileVersionOf } from '../src/client/fileVersions'
import { mediaUrl } from '../src/client/media'
import { startingChoice } from '../src/client/pictureReplace'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else {
    failures++
    console.log('  FAIL ' + name, extra ?? '')
  }
}

const NERU = '@tunnel:41chan.net'
const H = 3_600_000

console.log('== the pointer')
check('Neru-chan pointing at a replacement is a card', replacementPointer({ 'net.41chan.replacement': { id: 41, post_id: 9 } }, NERU) === 41)
check('anyone else carrying the key is plain text', replacementPointer({ 'net.41chan.replacement': { id: 41 } }, '@ann:x') === null)
check('no key, no card', replacementPointer({ body: 'x' }, NERU) === null)

console.log('== the record')
const T0 = Date.parse('2026-10-19T06:00:00Z')
const row = { id: 41, post_id: 9, old_file_retention: 'expire', old_file_expires_at: new Date(T0 + 24 * H).toISOString(), old_file_state: 'held', can_change: true }
{
  const r = parseReplacement(row)
  check('it parses', r !== null && r.id === 41 && r.postId === 9 && r.retention === 'expire' && r.state === 'held' && r.canChange === true)
  check('the deadline is the booru\'s, read as a time', r?.expiresAt === T0 + 24 * H)
  check('junk retention is unknown, not a choice', parseReplacement({ ...row, old_file_retention: 'forever' })?.retention === null)
  check('an error body is not a record', parseReplacement({ success: false, message: 'x' }) === null)
}

console.log('== what the card offers: only what the booru allows')
const rep = (over: Partial<Replacement>): Replacement => ({ id: 1, postId: 9, retention: 'expire', expiresAt: T0 + 24 * H, state: 'held', canChange: true, ...over })
check('expire, still changeable: offer keep (the undo)', replacementOffer(rep({})) === 'keep')
check('keep: offer expire', replacementOffer(rep({ retention: 'keep', expiresAt: null })) === 'expire')
check('the booru says no (the 24 hours are over): nothing, whatever this clock thinks', replacementOffer(rep({ canChange: false })) === null)
check('unknown can_change: nothing -- unmeasured is not permitted', replacementOffer(rep({ canChange: null })) === null)
check('scheduled: nothing', replacementOffer(rep({ state: 'scheduled' })) === null)
check('collected: nothing', replacementOffer(rep({ state: 'collected' })) === null)

console.log('== what the card says')
check('counting down to the booru\'s deadline', oldVersionText(rep({}), T0 + 22 * H + 30 * 60_000) === 'The old version is deleted in 1 h 30 min unless you keep it.', oldVersionText(rep({}), T0 + 22 * H + 30 * 60_000))
check('past it: collected next', /expired/.test(oldVersionText(rep({}), T0 + 25 * H)))
check('kept', oldVersionText(rep({ retention: 'keep' }), T0) === 'The old version is kept.')
check('collected', oldVersionText(rep({ state: 'collected' }), T0) === 'The old version has been deleted.')

console.log('== the write')
{
  const sent: Array<{ url: string; init: RequestInit }> = []
  const f = (async (url: string, init: RequestInit = {}) => {
    sent.push({ url, init })
    if (url.endsWith('/static/site_map')) return new Response('<meta name="csrf-token" content="TOK">', { status: 200 })
    if (init.method === 'POST') return new Response('{}', { status: 200 })
    return new Response(JSON.stringify({ ...row, old_file_retention: 'keep' }), { status: 200 })
  }) as unknown as typeof fetch
  const out = await setRetention(41, 'keep', f)
  const post = sent.find((x) => x.init.method === 'POST')
  const body = new URLSearchParams(String(post?.init.body))
  check('a simple POST to the replacement, the real verb as _method=put', !!post?.url.endsWith('/post_replacements/41.json') && body.get('_method') === 'put', post?.url)
  check('the choice and the token in the body', body.get('post_replacement[old_file_retention]') === 'keep' && body.get('authenticity_token') === 'TOK')
  check('then the record as the booru now has it', out.retention === 'keep')
}
{
  const f = (async (url: string) =>
    url.endsWith('/static/site_map')
      ? new Response('<meta name="csrf-token" content="TOK">', { status: 200 })
      : new Response(JSON.stringify({ message: 'The 24 hours to keep it have passed.' }), { status: 422 })) as unknown as typeof fetch
  let msg = ''
  try {
    await setRetention(41, 'keep', f)
  } catch (err) {
    msg = err instanceof Error ? err.message : String(err)
  }
  check('the booru refusing the undo is said, in its words, with the fix', /HTTP 422/.test(msg) && /24 hours to keep it have passed/.test(msg) && /Fix:/.test(msg), msg)
}

console.log('== the remembered choice')
check('nothing remembered: keep', startingChoice(undefined) === 'keep' && startingChoice({}) === 'keep')
check('expire remembered: starts on expire', startingChoice({ old_file: 'expire' }) === 'expire')
check('junk remembered: keep', startingChoice({ old_file: 'delete' }) === 'keep')

console.log('== the reload')
check('a 32-hex file_md5 is a version', fileVersionFrom({ post_id: 9, file_md5: 'a'.repeat(32) }) === 'a'.repeat(32))
check('anything else is none', fileVersionFrom({ file_md5: 'x' }) === null && fileVersionFrom({ post_id: 9 }) === null && fileVersionFrom(null) === null)
{
  type Ev = { getType: () => string; getStateKey: () => string; getContent: () => unknown }
  const ev = (mxc: string, content: unknown): Ev => ({ getType: () => 'net.41chan.media.tags', getStateKey: () => mxc, getContent: () => content })
  const handlers: Array<(e: Ev) => void> = []
  const client = {
    getHomeserverUrl: () => 'https://matrix.example',
    getRoom: () => null,
    getRooms: () => [{ currentState: { getStateEvents: () => [ev('mxc://41chan.net/REPLACED', { post_id: 9, file_md5: 'b'.repeat(32) }), ev('mxc://41chan.net/PLAIN', { post_id: 8 })] } }],
    on: (_t: string, h: (e: Ev) => void) => handlers.push(h),
  } as unknown as Parameters<typeof mediaUrl>[0]
  const replaced = mediaUrl(client, 'mxc://41chan.net/REPLACED') ?? ''
  const plain = mediaUrl(client, 'mxc://41chan.net/PLAIN') ?? ''
  const thumb = mediaUrl(client, 'mxc://41chan.net/REPLACED', 320) ?? ''
  check('a replaced picture\'s download carries v=<new md5>', new URL(replaced).searchParams.get('v') === 'b'.repeat(32), replaced)
  check('and so does its thumbnail', new URL(thumb).searchParams.get('v') === 'b'.repeat(32), thumb)
  check('a picture never replaced keeps the URL it always had (nothing cached is refetched)', !plain.includes('v='), plain)
  for (const h of handlers) h(ev('mxc://41chan.net/PLAIN', { post_id: 8, file_md5: 'c'.repeat(32) }))
  check('a replacement landing live changes the URL', fileVersionOf(client, 'mxc://41chan.net/PLAIN') === 'c'.repeat(32) && (mediaUrl(client, 'mxc://41chan.net/PLAIN') ?? '').includes('v=' + 'c'.repeat(32)))
}

if (failures) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
