// BURs: which messages may carry a card, what the card says, and what it
// offers -- plus the write's shape (a simple POST, the token in the body, the
// verb's route), proven against a stand-in fetch.
//
// The BUR shape is the booru's published contract (chanbooru ca05bee43, sent
// by the chanbooru session 2026-10-19): the row plus can_approve, can_reject,
// skipped_count, failed_line and per-line `lines`. No BUR existed to capture,
// so the fixture is built from that contract field by field.
import {
  approveBur,
  burActions,
  burPointer,
  burStatusText,
  BurRefusal,
  lineStateText,
  parseBur,
  readBur,
  refusalLines,
  refusalText,
  rejectBur,
  BOORU_ADMIN,
  type Bur,
} from '../src/client/booruBur'
import { resetBooruCsrf } from '../src/client/booruCsrf'
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

console.log('== the booru row (chanbooru ca05bee43 contract)')
const ROW = {
  id: 77, user_id: 4, approver_id: null,
  script: 'alias old_tag -> new_tag\r\n\r\nupdate a -> b\n',
  tags: ['old_tag', 'new_tag', 'a', 'b'],
  status: 'pending', reason: 'tidy the artist tags\n\nRequested by @voice:41chan.net', forum_topic_id: null, forum_post_id: null,
  can_approve: true, can_reject: true, skipped_count: 0, failed_line: null, lines: [],
  created_at: '2026-10-19T20:00:00.000Z', updated_at: '2026-10-19T20:00:00.000Z',
}
{
  const b = parseBur(ROW)
  check('it parses', b !== null)
  check('before a run: the script, numbered as stored with blank lines counted', JSON.stringify(b?.lines.map((l) => [l.line, l.command])) === JSON.stringify([[1, 'alias old_tag -> new_tag'], [3, 'update a -> b']]), b?.lines)
  check('the reason is kept as text', b?.reason === 'tidy the artist tags\n\nRequested by @voice:41chan.net')
  check('the per-viewer flags are kept', b?.canApprove === true && b?.canReject === true)
  check('an unknown status is not a BUR', parseBur({ ...ROW, status: 'queued' }) === null)
  check('partial is a status', parseBur({ ...ROW, status: 'partial' })?.status === 'partial')
  check('an error body is not a BUR', parseBur({ success: false, message: 'That record was not found.' }) === null)
  const ran = parseBur({ ...ROW, status: 'partial', skipped_count: 2, lines: [
    { line: 1, command: 'alias old_tag -> new_tag', state: 'done', matched: null, skipped: 0, skipped_post_ids: [], skipped_reasons: [], error: null, remedy: null },
    { line: 3, command: 'update a -> b', state: 'skipped_some', matched: 40, skipped: 2, skipped_post_ids: [5, 6], skipped_reasons: [{ message: 'the post is locked', count: 2 }], error: null, remedy: null },
  ] })
  check('after a run: the lines are the booru\'s, with their states', ran?.lines.length === 2 && ran?.lines[1].state === 'skipped_some' && ran?.lines[1].skippedReasons[0].count === 2)
  check('a line says how far it got', lineStateText(ran!.lines[1]) === 'done, 2 skipped of 40' && lineStateText(ran!.lines[0]) === 'done', ran?.lines.map(lineStateText))
}

console.log('== what the card offers')
const bur = (status: Bur['status'], extra: Partial<Bur> = {}): Bur => ({ id: 1, status, lines: [], reason: null, skippedCount: null, failedLine: null, ...extra })
{
  check('the booru\'s flags decide: approve and reject', (() => { const a = burActions(bur('pending', { canApprove: true, canReject: true }), null); return a.approve && a.reject })())
  check('the booru saying no is no, whatever the level', (() => { const a = burActions(bur('pending', { canApprove: false, canReject: false }), BOORU_ADMIN); return !a.approve && !a.reject })())
  check('a rejected BUR reads can_approve true, can_reject false', (() => { const a = burActions(bur('rejected', { canApprove: true, canReject: false }), null); return a.approve && !a.reject })())
  // The fallback, for a booru that sends no flags.
  const a = burActions(bur('pending'), BOORU_ADMIN)
  check('fallback: admin, pending: approve and reject', a.approve && a.reject)
  for (const s of ['failed', 'partial', 'rejected'] as const) {
    const x = burActions(bur(s), BOORU_ADMIN)
    check(`fallback: admin, ${s}: approvable again, no reject`, x.approve && !x.reject)
  }
  for (const s of ['processing', 'approved'] as const) {
    const x = burActions(bur(s), BOORU_ADMIN)
    check(`fallback: admin, ${s}: nothing`, !x.approve && !x.reject)
  }
  const mod = burActions(bur('pending'), 40)
  check('fallback: moderator: nothing', !mod.approve && !mod.reject)
  check('fallback: unknown level: nothing -- unmeasured is not permitted', (() => { const u = burActions(bur('pending'), null); return !u.approve && !u.reject })())
}
check('every status has words', (['pending', 'processing', 'approved', 'partial', 'rejected', 'failed'] as const).every((s) => burStatusText(s).length > 0))

console.log('== refusals')
const REFUSED = { success: false, error: 'BulkUpdateRequest::Processor::Error', message: 'BUR #77 was not approved and is unchanged. Its script no longer passes the checks: x. Fix: edit its script on the booru so every line is valid today, then approve it again', errors: [{ line: 3, text: 'update a -> b', reason: 'This line names a tag only an admin may change' }] }
check('the sentence is the booru\'s message', refusalText(REFUSED) === REFUSED.message)
check('the lines it names, by line', refusalLines(REFUSED).get(3) === 'This line names a tag only an admin may change')
check('nothing readable', refusalText({}) === null && refusalText(null) === null)

console.log('== the writes')
type Sent = { url: string; init: RequestInit }
function fakeFetch(answers: Array<{ status: number; json?: unknown; empty?: boolean }>): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = []
  let i = 0
  let token = 0
  const f = (async (url: string, init: RequestInit = {}) => {
    sent.push({ url, init })
    if (url.endsWith('/static/site_map')) {
      token++
      return new Response(`<meta name="csrf-token" content="TOKEN${token}">`, { status: 200 })
    }
    const a = answers[Math.min(i++, answers.length - 1)]
    if (a.empty) return new Response(null, { status: a.status })
    return new Response(JSON.stringify(a.json ?? {}), { status: a.status })
  }) as unknown as typeof fetch
  return { fetch: f, sent }
}
const posts = (sent: Sent[]) => sent.filter((s) => s.init.method === 'POST')
{
  resetBooruCsrf()
  const { fetch: f, sent } = fakeFetch([{ status: 201, json: { ...ROW, status: 'processing', can_approve: false, can_reject: false } }])
  const out = await approveBur(77, f)
  const post = posts(sent)[0]
  check('approve lands on the approve route', !!post?.url.endsWith('/bulk_update_requests/77/approve.json'), post?.url)
  check('as a POST with the cookie', post?.init.method === 'POST' && post?.init.credentials === 'include')
  const headers = (post?.init.headers ?? {}) as Record<string, string>
  check('only CORS-safelisted headers (no preflight to refuse)', Object.keys(headers).every((h) => ['Accept', 'Content-Type'].includes(h)) && headers['Content-Type'] === 'application/x-www-form-urlencoded', headers)
  const body = new URLSearchParams(String(post?.init.body))
  check('the token rides in the body', body.get('authenticity_token') === 'TOKEN1')
  check('approve carries no _method', body.get('_method') === null)
  check('the 201 is the BUR as it now stands', out.status === 'processing')
}
{
  resetBooruCsrf()
  const { fetch: f, sent } = fakeFetch([{ status: 204, empty: true }, { status: 200, json: { ...ROW, status: 'rejected', can_approve: true, can_reject: false } }])
  const out = await rejectBur(77, f)
  const post = posts(sent)[0]
  const body = new URLSearchParams(String(post?.init.body))
  check('reject is the BUR route with _method=delete', !!post?.url.endsWith('/bulk_update_requests/77.json') && body.get('_method') === 'delete', post?.url)
  check('its 204 is followed by a fresh read', out.status === 'rejected' && sent.filter((s) => !s.init.method).length >= 1)
}
{
  resetBooruCsrf()
  const { fetch: f, sent } = fakeFetch([
    { status: 403, json: { success: false, error: 'ActionController::InvalidAuthenticityToken', message: 'x' } },
    { status: 201, json: { ...ROW, status: 'processing' } },
  ])
  const out = await approveBur(77, f).catch((err: unknown) => err)
  const p = posts(sent)
  check('a stale-token 403 is retried ONCE with a fresh token', p.length === 2 && new URLSearchParams(String(p[1].init.body)).get('authenticity_token') === 'TOKEN2' && (out as Bur).status === 'processing', out)
}
{
  resetBooruCsrf()
  const { fetch: f, sent } = fakeFetch([{ status: 422, json: REFUSED }])
  let caught: unknown = null
  try {
    await approveBur(77, f)
  } catch (err) {
    caught = err
  }
  check('a 422 is never retried', posts(sent).length === 1)
  check('it throws the booru\'s own sentence, with no generic suffix', caught instanceof BurRefusal && caught.message === REFUSED.message, caught)
  check('and the lines it names', caught instanceof BurRefusal && caught.lineErrors.get(3) === 'This line names a tag only an admin may change')
}
{
  resetBooruCsrf()
  const { fetch: f } = fakeFetch([{ status: 403, json: { success: false, error: 'Pundit::NotAuthorizedError', message: 'Access denied' } }])
  let msg = ''
  try {
    await approveBur(77, f)
  } catch (err) {
    msg = err instanceof Error ? err.message : String(err)
  }
  check('a policy 403 is not retried and says the booru\'s words', msg === 'Access denied', msg)
}
{
  const f = (async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch
  let msg = ''
  try {
    await readBur(77, f)
  } catch (err) {
    msg = err instanceof Error ? err.message : String(err)
  }
  check('a rejected fetch is a missing session, said with its fix', /open the booru panel once to sign in there, then reopen this room/.test(msg), msg)
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
