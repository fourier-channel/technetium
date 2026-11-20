// The blocklist edited from Technetium (operator, approved 2026-11-20): the
// block control beside purge/refresh writes to the booru account, and the
// list the booru answers with is applied, so pictures leave and return live.
//
// Holds: an edit is the booru's own PATCH /modulation/settings, sent as a
// CORS-simple POST (_method=patch, form body, CSRF token in the body,
// credentials); a 200 is the whole list, locks included; a 422 surfaces the
// booru's own sentence; any other answer is a fault naming its fix, never an
// empty list; an edit's answer outranks a read that started before it
// arrived; edits run one at a time in the order made; applying a list judges
// every picture again (the rule listeners fire); the room count is the
// pictures the timeline hides; the control is mounted joined to the left of
// purge/refresh in the signed-in header; a locked pill draws no remove button.
//
// Every property carries a SABOTAGE control: the same probe, run against a
// deliberately wrong version, must judge it wrong -- so a green here is
// evidence the probe can see the failure, not only that it ran.
import { readFileSync } from 'node:fs'
const {
  sendBlocklistEdit, BlocklistRefused, BLOCKLIST_EDIT_PATH, applyBlocklistEdit, editQueue,
  beginBlocklistRead, applyBlocklistRead, setBlocklist, currentBlocks, onBlocklistChanged,
  clearBlocklist, resetBlocklistForTest,
} = await import('../src/client/booruBlocklist.ts')
const { hiddenInRoom } = await import('../src/client/hiddenInRoom.ts')
const { resetBooruCsrf } = await import('../src/client/booruCsrf.ts')
const { BOORU_ORIGIN } = await import('../src/client/booruUrl.ts')
const { BOORU_REF_KEY, BOORU_MEDIA_SERVER } = await import('../src/client/booruRef.ts')

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const TOKEN_PAGE_HTML =
  '<html><head><meta name="csrf-param" content="authenticity_token" />' +
  '<meta name="csrf-token" content="TESTTOKEN123" /></head></html>'

interface Sent { url: string; init: RequestInit }
function booru(status: number, body: unknown) {
  const sent: Sent[] = []
  const impl = (async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    sent.push({ url: u, init: init ?? {} })
    const page = u.includes('/static/site_map')
    return {
      ok: page ? true : status >= 200 && status < 300,
      status: page ? 200 : status,
      json: async () => body,
      text: async () => TOKEN_PAGE_HTML,
      clone() { return this },
    } as unknown as Response
  }) as unknown as typeof fetch
  return { sent, impl }
}

// The judge of an edit request's shape, used on the real request and on a
// sabotaged one.
function shapeFaults(s: Sent | undefined, op: string, rule: string): string[] {
  if (!s) return ['nothing was sent']
  const out: string[] = []
  if (s.url !== `${BOORU_ORIGIN}${BLOCKLIST_EDIT_PATH}`) out.push('url ' + s.url)
  if ((s.init.method ?? 'GET').toUpperCase() !== 'POST') out.push('method ' + s.init.method)
  if (s.init.credentials !== 'include') out.push('no credentials')
  const headers = Object.keys((s.init.headers ?? {}) as Record<string, string>).map((h) => h.toLowerCase())
  for (const h of headers) if (h !== 'accept' && h !== 'content-type') out.push('header ' + h)
  const body = new URLSearchParams(String(s.init.body ?? ''))
  if (body.get('_method') !== 'patch') out.push('_method ' + body.get('_method'))
  if (body.get('blocklist[op]') !== op) out.push('op ' + body.get('blocklist[op]'))
  if (body.get('blocklist[rule]') !== rule) out.push('rule ' + body.get('blocklist[rule]'))
  if (body.get('authenticity_token') !== 'TESTTOKEN123') out.push('token ' + body.get('authenticity_token'))
  return out
}

console.log('\n-- an edit is the booru route, sent CORS-simple --')
{
  resetBooruCsrf()
  const ok = booru(200, { blocklist: [{ rule: 'spoilers', locked: false }, { rule: 'gore', locked: true }] })
  const list = await sendBlocklistEdit('add', 'spoilers', ok.impl)
  const edit = ok.sent.find((s) => !s.url.includes('/static/site_map'))
  const faults = shapeFaults(edit, 'add', 'spoilers')
  check('the request has the booru route\'s exact shape', faults.length === 0, faults)
  check('the answer is the whole list, locks kept',
    list.length === 2 && list[0].rule === 'spoilers' && list[1].locked === true, list)
  // SABOTAGE: a PATCH sent as a real PATCH (preflighted, refused) is judged wrong.
  const bad: Sent = { url: edit!.url, init: { ...edit!.init, method: 'PATCH', body: String(edit!.init.body).replace('_method=patch', '') } }
  check('SABOTAGE a real PATCH without _method is judged wrong', shapeFaults(bad, 'add', 'spoilers').length >= 2)
}

console.log('\n-- a refusal is the booru\'s own words; anything else is a fault --')
{
  resetBooruCsrf()
  const words = "'gore' is locked. Unlock it first (the padlock on its pill), then remove it."
  const r422 = booru(422, { error: words })
  let got: unknown = null
  try { await sendBlocklistEdit('remove', 'gore', r422.impl) } catch (e) { got = e }
  check('a 422 is a BlocklistRefused', got instanceof BlocklistRefused, got)
  check('carrying the booru\'s sentence unchanged', (got as Error)?.message === words, (got as Error)?.message)

  resetBooruCsrf()
  const r500 = booru(500, { oops: true })
  got = null
  try { await sendBlocklistEdit('add', 'x', r500.impl) } catch (e) { got = e }
  check('a 500 is a fault, not a refusal', got instanceof Error && !(got instanceof BlocklistRefused), got)
  check('and names its fix', /Fix:/.test((got as Error)?.message ?? ''))

  resetBooruCsrf()
  const noList = booru(200, { ok: true })
  got = null
  try { await sendBlocklistEdit('add', 'x', noList.impl) } catch (e) { got = e }
  check('a 200 with no list is a fault, never an empty list applied', got instanceof Error, got)

  // SABOTAGE: the same judge on a 403 (not a refusal of the edit) must not call it one.
  resetBooruCsrf()
  const r403 = booru(403, { error: 'Forbidden' })
  got = null
  try { await sendBlocklistEdit('add', 'x', r403.impl) } catch (e) { got = e }
  check('SABOTAGE a 403 with an error text is NOT shown as the booru refusing the edit',
    got instanceof Error && !(got instanceof BlocklistRefused), got)
}

console.log('\n-- an edit\'s answer outranks a read that started before it arrived --')
{
  resetBlocklistForTest()
  const before = [{ rule: 'old', locked: false }]
  const after = [{ rule: 'old', locked: false }, { rule: 'new', locked: false }]
  const read = beginBlocklistRead() // a timer read goes out...
  applyBlocklistEdit(after) // ...the edit's answer lands...
  const dropped = applyBlocklistRead(read, before) // ...then the read's (pre-edit) answer
  check('the older read is dropped', dropped === null)
  check('the edit stands', currentBlocks().map((b) => b.rule).join(',') === 'old,new', currentBlocks())
  const later = beginBlocklistRead()
  check('a read started after the edit still applies', applyBlocklistRead(later, after) !== null)

  // SABOTAGE: numbered when SENT (before the timer read began), the edit is
  // overwritten by the stale read -- the probe above sees exactly that.
  resetBlocklistForTest()
  const sentAt = beginBlocklistRead()
  const timer = beginBlocklistRead()
  applyBlocklistRead(sentAt, after)
  applyBlocklistRead(timer, before)
  check('SABOTAGE numbered at sending, the stale read wins and the probe sees it',
    currentBlocks().map((b) => b.rule).join(',') === 'old')
}

console.log('\n-- sign-out drops what is on its way --')
{
  resetBlocklistForTest()
  const read = beginBlocklistRead()
  setBlocklist([{ rule: 'a', locked: false }])
  clearBlocklist()
  check('a read from before sign-out is dropped', applyBlocklistRead(read, [{ rule: 'a', locked: false }]) === null)
  const tags = readFileSync('src/client/useMediaTags.ts', 'utf8')
  const edit = tags.slice(tags.indexOf('export function editBlocklist'), tags.indexOf('function loadBlocklist'))
  check('an edit answered after sign-out or an account switch is not applied',
    /const client = fetchClient/.test(edit) && edit.indexOf('if (fetchClient !== client) return') < edit.indexOf('applyBlocklistEdit('),
    edit.slice(0, 300))
  check('edits go through the queue', /return queueEdit\(run\)/.test(edit))
  check('and through the booru session gate', /withBooruSession\(\(\) => sendBlocklistEdit\(/.test(edit))
}

console.log('\n-- edits run one at a time, in the order made --')
{
  const order: string[] = []
  const slow = (name: string, ms: number, fail = false) => () =>
    new Promise<string>((res, rej) => setTimeout(() => { order.push(name); fail ? rej(new Error(name)) : res(name) }, ms))
  const q = editQueue()
  const a = q(slow('a', 30))
  const b = q(slow('b', 1, true))
  const c = q(slow('c', 1))
  await Promise.allSettled([a, b, c])
  check('finished in the order made, though the first was slowest', order.join('') === 'abc', order)
  check('a failed edit does not stop the next', (await c) === 'c')
  // SABOTAGE: without the queue the same three finish out of order.
  const raw: string[] = []
  const go = (name: string, ms: number) => new Promise<void>((res) => setTimeout(() => { raw.push(name); res() }, ms))
  await Promise.all([go('a', 30), go('b', 1), go('c', 1)])
  check('SABOTAGE unqueued, the probe sees them out of order', raw.join('') !== 'abc', raw)
}

console.log('\n-- applying a list judges every picture again, and keeps locks --')
{
  resetBlocklistForTest()
  let fired = 0
  onBlocklistChanged(() => fired++)
  const first = currentBlocks()
  applyBlocklistEdit([{ rule: 'x', locked: true }])
  check('the rule listeners fired (useMediaTags judges every picture on it)', fired === 1, fired)
  check('the lock is kept in the store', currentBlocks()[0]?.locked === true)
  check('a new array, so the panel re-renders', currentBlocks() !== first)
  const tags = readFileSync('src/client/useMediaTags.ts', 'utf8')
  check('useMediaTags re-judges on that signal', /onBlocklistChanged\(\(\) => \{\s*for \(const mediaId of sets\.keys\(\)\) judge\(mediaId\)/.test(tags))
}

console.log('\n-- the room count is the pictures the timeline hides --')
{
  const MD5 = '0123456789abcdef0123456789abcdef'
  const ev = (c: Record<string, unknown>) => ({ getContent: () => c })
  const events = [
    ev({ msgtype: 'm.image', url: 'mxc://41chan.net/AAA' }),
    ev({ msgtype: 'm.image', url: 'mxc://41chan.net/BBB' }),
    ev({ msgtype: 'm.text', body: 'x', [BOORU_REF_KEY]: { post_id: 3, md5: MD5, ext: 'png' } }),
    ev({ msgtype: 'm.text', body: 'x', [BOORU_REF_KEY]: { md5: MD5, ext: 'png' } }), // being tagged: nothing shown
    ev({ msgtype: 'm.text', body: 'hello' }),
  ]
  const client = { getRoom: (id: string) => id === '!r:x' ? { getLiveTimeline: () => ({ getEvents: () => events }) } : null } as any
  const blocked = new Set(['AAA', `${MD5}.png`])
  check('an m.image and a posted booru reference are counted', hiddenInRoom(client, '!r:x', blocked) === 2,
    hiddenInRoom(client, '!r:x', blocked))
  check('another room counts nothing', hiddenInRoom(client, '!other:x', blocked) === 0)
  check('nothing blocked is zero', hiddenInRoom(client, '!r:x', new Set()) === 0)
  // SABOTAGE: counted by the full mxc instead of the media id, it would see nothing.
  const byMxc = new Set([`mxc://${BOORU_MEDIA_SERVER}/${MD5}.png`, 'mxc://41chan.net/AAA'])
  check('SABOTAGE keyed by the wrong address, the count is wrong and the probe sees it',
    hiddenInRoom(client, '!r:x', byMxc) !== 2)
}

console.log('\n-- the control: joined left of purge/refresh, locks honoured --')
{
  const app = readFileSync('src/App.tsx', 'utf8')
  const row = app.slice(app.indexOf('<div className="tc-me-reset">'))
  const joined = (src: string) => {
    const r = src.slice(src.indexOf('<div className="tc-me-reset">'))
    const b = r.indexOf('<BlocklistControl'), s = r.indexOf('<SiteReset />'), end = r.indexOf('</div>')
    return src.includes('<div className="tc-me-reset">') && b >= 0 && b < s && s < end
  }
  check('the block control sits in one row with SiteReset, on its left', joined(app), row.slice(0, 200))
  check('in the signed-in header', app.indexOf('<div className="tc-me">') < app.indexOf('<div className="tc-me-reset">'))
  check('SABOTAGE swapped order is judged wrong',
    !joined(app.replace('<BlocklistControl client={client} roomId={selectedRoomId} />\n              <SiteReset />',
      '<SiteReset />\n              <BlocklistControl client={client} roomId={selectedRoomId} />')))

  const ui = readFileSync('src/ui/BlocklistControl.tsx', 'utf8')
  const lockedGuard = (src: string) => /\{!b\.locked && \(\s*<button[^>]*?\n?\s*type="button"\s*className="tc-blocklist-pill-remove"/.test(src)
  check('a locked pill draws no remove button', lockedGuard(ui))
  check('SABOTAGE an unguarded remove button is judged wrong',
    !lockedGuard(ui.replace('{!b.locked && (', '{(')))
  check('the panel shows the booru\'s refusal', /role="alert"/.test(ui) && /BlocklistRefused/.test(ui))
  check('the count\'s room is always reserved (visibility, not display)',
    /\.tc-blocklist-count \{[^}]*visibility: hidden/.test(readFileSync('src/index.css', 'utf8')))
  check('rules Tc cannot apply are marked', /not applied in Tc/.test(ui))
  const inputDisabled = (src: string) => {
    const at = src.indexOf('className="tc-blocklist-input"')
    return /(?<![-\w])disabled[=\s/]/.test(src.slice(at, src.indexOf('/>', at)))
  }
  check('the input is never disabled while sending (that would drop focus and close the panel)', !inputDisabled(ui))
  check('SABOTAGE a disabled input is judged wrong',
    inputDisabled(ui.replace('className="tc-blocklist-input"', 'className="tc-blocklist-input"\n          disabled={busy}')))
}

resetBlocklistForTest()
console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
process.exit(failures === 0 ? 0 : 1)
