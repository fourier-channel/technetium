// BURs: which messages may carry a card, what the card says, and what it
// offers -- plus the write's shape (a simple POST, the token in the body, the
// verb's route), proven against a stand-in fetch.
//
// The BUR shape is the booru's own table (chanbooru db/structure.sql
// bulk_update_requests: id, user_id, forum_topic_id, script, status,
// created_at, updated_at, approver_id, forum_post_id, tags). No BUR existed on
// the dev booru to capture on 2026-10-19, so the fixture is that row
// serialised the way Danbooru serialises every model.
import {
  approveBur,
  burActions,
  burPointer,
  burStatusText,
  parseBur,
  refusalText,
  rejectBur,
  BOORU_ADMIN,
  type Bur,
} from '../src/client/booruBur'
import { shownHonorific } from '../src/client/members'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else {
    failures++
    console.log('  FAIL ' + name, extra ?? '')
  }
}

const NERU = '@tunnel:41chan.net'

console.log('== the pointer')
check('Neru-chan pointing at a BUR is a card', burPointer({ body: 'x', 'net.41chan.bur': { id: 77 } }, NERU) === 77)
check('anyone else carrying the key is plain text', burPointer({ 'net.41chan.bur': { id: 77 } }, '@voice:41chan.net') === null)
check('no sender, no card', burPointer({ 'net.41chan.bur': { id: 77 } }, undefined) === null)
check('a non-integer id is no card', burPointer({ 'net.41chan.bur': { id: '77' } }, NERU) === null)
check('zero and negatives are no card', burPointer({ 'net.41chan.bur': { id: 0 } }, NERU) === null)
check('no key, no card', burPointer({ body: 'Filed BUR #77' }, NERU) === null)

console.log('== the booru row')
const ROW = {
  id: 77,
  user_id: 4,
  forum_topic_id: 12,
  script: 'alias old_tag -> new_tag\r\n\r\nupdate a -> b\n',
  status: 'pending',
  created_at: '2026-10-19T20:00:00.000Z',
  updated_at: '2026-10-19T20:00:00.000Z',
  approver_id: null,
  forum_post_id: 30,
  tags: ['old_tag', 'new_tag', 'a', 'b'],
}
{
  const b = parseBur(ROW)
  check('it parses', b !== null)
  check('script lines split, blanks dropped', JSON.stringify(b?.lines) === JSON.stringify(['alias old_tag -> new_tag', 'update a -> b']), b?.lines)
  check('no per-viewer fields means none invented', b?.canApprove === undefined && b?.canReject === undefined)
  check('an unknown status is not a BUR', parseBur({ ...ROW, status: 'queued' }) === null)
  check('an error body is not a BUR', parseBur({ success: false, message: 'That record was not found.' }) === null)
  const named = parseBur({ ...ROW, can_approve: false, can_reject: true })
  check('the booru\'s per-viewer answer is kept', named?.canApprove === false && named?.canReject === true)
}

console.log('== what the card offers')
const bur = (status: Bur['status'], extra: Partial<Bur> = {}): Bur => ({ id: 1, status, lines: [], ...extra })
{
  const a = burActions(bur('pending'), BOORU_ADMIN)
  check('admin, pending: approve and reject', a.approve && a.reject)
  const f = burActions(bur('failed'), BOORU_ADMIN)
  check('admin, failed: approve again, no reject', f.approve && !f.reject)
  const rej = burActions(bur('rejected'), BOORU_ADMIN)
  check('admin, rejected: approvable, as upstream (operator ruling 2026-10-19), no reject', rej.approve && !rej.reject)
  for (const s of ['processing', 'approved'] as const) {
    const x = burActions(bur(s), BOORU_ADMIN)
    check(`admin, ${s}: nothing`, !x.approve && !x.reject)
  }
  const mod = burActions(bur('pending'), 40)
  check('moderator: nothing (this fork needs Admin for nearly every line)', !mod.approve && !mod.reject)
  const unknown = burActions(bur('pending'), null)
  check('unknown level: nothing -- unmeasured is not permitted', !unknown.approve && !unknown.reject)
  const told = burActions(bur('pending', { canApprove: true, canReject: false }), 0)
  check('the booru saying yes outranks the level guess', told.approve && !told.reject)
  const denied = burActions(bur('pending', { canApprove: false }), BOORU_ADMIN)
  check('the booru saying no outranks it too', !denied.approve && denied.reject)
  const notNow = burActions(bur('approved', { canApprove: true }), BOORU_ADMIN)
  check('a decided BUR offers nothing whatever the booru says', !notNow.approve && !notNow.reject)
}
check('every status has words', (['pending', 'processing', 'approved', 'rejected', 'failed'] as const).every((s) => burStatusText(s).length > 0))

console.log('== refusals')
check('per-line array', refusalText({ errors: [{ line: 2, text: 'x', reason: 'unknown tag' }] }) === 'line 2: unknown tag')
check('Rails hash', refusalText({ errors: { script: ['Unknown line'] } }) === 'Unknown line')
check('bare message', refusalText({ message: 'nope' }) === 'nope')
check('nothing readable', refusalText({}) === null && refusalText(null) === null)

console.log('== the writes')
type Sent = { url: string; init: RequestInit }
function fakeFetch(answers: Array<{ status: number; json?: unknown; text?: string }>): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = []
  let i = 0
  const f = (async (url: string, init: RequestInit = {}) => {
    sent.push({ url, init })
    if (url.endsWith('/static/site_map')) {
      return new Response('<meta name="csrf-token" content="TOKEN1">', { status: 200 })
    }
    const a = answers[Math.min(i++, answers.length - 1)]
    return new Response(a.text ?? JSON.stringify(a.json ?? {}), { status: a.status })
  }) as unknown as typeof fetch
  return { fetch: f, sent }
}
{
  const { fetch: f, sent } = fakeFetch([{ status: 200, json: { ...ROW, status: 'processing' } }])
  const out = await approveBur(77, f)
  const post = sent.find((s) => !s.url.endsWith('/static/site_map'))
  check('approve lands on the approve route', !!post?.url.endsWith('/bulk_update_requests/77/approve.json'), post?.url)
  check('as a POST with the cookie', post?.init.method === 'POST' && post?.init.credentials === 'include')
  const headers = (post?.init.headers ?? {}) as Record<string, string>
  check('only CORS-safelisted headers (no preflight to refuse)', Object.keys(headers).every((h) => ['Accept', 'Content-Type'].includes(h)) && headers['Content-Type'] === 'application/x-www-form-urlencoded', headers)
  const body = new URLSearchParams(String(post?.init.body))
  check('the token rides in the body', body.get('authenticity_token') === 'TOKEN1')
  check('approve carries no _method', body.get('_method') === null)
  check('the answer is the BUR as it now stands', out.status === 'processing')
}
{
  const { fetch: f, sent } = fakeFetch([{ status: 200, json: { ...ROW, status: 'rejected' } }])
  const out = await rejectBur(77, f)
  const post = sent.find((s) => !s.url.endsWith('/static/site_map'))
  const body = new URLSearchParams(String(post?.init.body))
  check('reject is the BUR route with _method=delete', !!post?.url.endsWith('/bulk_update_requests/77.json') && body.get('_method') === 'delete', post?.url)
  check('reject answers rejected', out.status === 'rejected')
}
{
  const { fetch: f } = fakeFetch([{ status: 403, json: { success: false, message: 'Access denied' } }])
  let msg = ''
  try {
    await approveBur(77, f)
  } catch (err) {
    msg = err instanceof Error ? err.message : String(err)
  }
  check('a refusal throws, naming the status, the booru\'s words and the fix', /HTTP 403/.test(msg) && /Access denied/.test(msg) && /Fix:/.test(msg), msg)
}

console.log('== the rank a row draws')
{
  const plus = shownHonorific(25, [0, 0])
  check('+ held here: +, full strength', plus.glyph === '+' && plus.here)
  const dim = shownHonorific(0, [25])
  check('+ held only elsewhere: +, dimmed', dim.glyph === '+' && !dim.here)
  const modAndPlus = shownHonorific(25, [50])
  check('a moderator elsewhere voiced HERE shows + at strength, not a dim @', modAndPlus.glyph === '+' && modAndPlus.here)
  const modHere = shownHonorific(50, [25])
  check('the rank here wins whichever is higher', modHere.glyph === '@' && modHere.here)
  const none = shownHonorific(0, [10])
  check('no rank anywhere: nothing', none.glyph === null && !none.here)
  const notMember = shownHonorific(null, [100])
  check('not a member here: highest elsewhere, dimmed', notMember.glyph === '~' && !notMember.here)
}

if (failures) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
