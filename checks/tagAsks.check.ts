// The tag line's states, and the cold-start ask that used to vanish.
//
// The failure this guards (2026-10-05): an image's first ask for its tags ran
// before the tag store had a client, returned early, and was never made again,
// so a cold start showed images with no tags and no sign that any were coming.
import {
  askKey,
  beginAsk,
  heardOf,
  isAbsent,
  newTagAsks,
  retry,
  settle,
  tagLineView,
  takeDeferred,
} from '../src/client/tagAsks'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const R = '!room:41chan.net'
const MXC = 'mxc://41chan.net/abc'
const ID = 'abc'
const K = askKey(R, ID)

console.log('== an ask made before the client exists is kept, not dropped')
{
  const s = newTagAsks()
  check('no client: deferred', beginAsk(s, R, MXC, ID, { haveClient: false, haveSet: false }) === 'defer')
  check('the line says loading meanwhile', tagLineView(false, s.status.get(K), true) === 'loading')
  check('a second render does not park it twice',
    beginAsk(s, R, MXC, ID, { haveClient: false, haveSet: false }) === 'skip' && s.deferred.size === 1)
  const run = takeDeferred(s)
  check('the client arrives: the parked ask comes out', run.length === 1 && run[0].mxc === MXC && run[0].roomId === R, run)
  check('and only once', takeDeferred(s).length === 0)
}

console.log('== with a client, an image is asked about once')
{
  const s = newTagAsks()
  check('first render asks', beginAsk(s, R, MXC, ID, { haveClient: true, haveSet: false }) === 'go')
  check('a re-render while asking does not ask again', beginAsk(s, R, MXC, ID, { haveClient: true, haveSet: false }) === 'skip')
  check('a set already held is never asked about', beginAsk(newTagAsks(), R, MXC, ID, { haveClient: true, haveSet: true }) === 'skip')
}

console.log('== each answer is its own state on the line')
{
  const s = newTagAsks()
  beginAsk(s, R, MXC, ID, { haveClient: true, haveSet: false })
  settle(s, K, 'absent')
  check('404: the line says no tags', tagLineView(false, s.status.get(K), true) === 'none')
  check('absent is not asked again on render', beginAsk(s, R, MXC, ID, { haveClient: true, haveSet: false }) === 'skip')

  const f = newTagAsks()
  beginAsk(f, R, MXC, ID, { haveClient: true, haveSet: false })
  settle(f, K, { failed: 'HTTP 502' })
  check('other errors: the line says it could not load', tagLineView(false, f.status.get(K), true) === 'failed')
  check('the reason is kept for the line to show', f.reason.get(K) === 'HTTP 502')
  check('a failure is not retried by a render', beginAsk(f, R, MXC, ID, { haveClient: true, haveSet: false }) === 'skip')
  retry(f, K)
  check('a retry lets the next render ask', beginAsk(f, R, MXC, ID, { haveClient: true, haveSet: false }) === 'go')
  check('retry does nothing to an image that is not failed', (() => { const a = newTagAsks(); beginAsk(a, R, MXC, ID, { haveClient: true, haveSet: false }); settle(a, K, 'absent'); retry(a, K); return a.status.get(K) === 'absent' })())

  const ok = newTagAsks()
  beginAsk(ok, R, MXC, ID, { haveClient: true, haveSet: false })
  settle(ok, K, 'found')
  check('found: the record goes, the set is the answer', !ok.status.has(K))
  check('a set always shows as tags', tagLineView(true, 'absent', true) === 'tags' && tagLineView(true, undefined, false) === 'tags')
}

console.log('== a tag arriving over sync overrules a stale "no tags"')
{
  const s = newTagAsks()
  beginAsk(s, R, MXC, ID, { haveClient: true, haveSet: false })
  settle(s, K, 'absent')
  const other = askKey('!other:41chan.net', ID)
  s.status.set(other, 'failed')
  const asking = askKey('!third:41chan.net', ID)
  s.status.set(asking, 'asking')
  const cleared = heardOf(s, ID)
  check('every room\'s answer for that image is cleared', !s.status.has(K) && !s.status.has(other), cleared)
  check('an ask still out is left to finish', s.status.get(asking) === 'asking')
  check('another image is untouched', (() => { const t = newTagAsks(); t.status.set(askKey(R, 'xabc'), 'absent'); heardOf(t, 'abc'); return t.status.get(askKey(R, 'xabc')) === 'absent' })())
}

console.log('== nowhere to ask is not a loading state that never ends')
check('no room, no set: blank', tagLineView(false, undefined, false) === 'blank')
check('first paint, before the ask: loading', tagLineView(false, 'unasked', true) === 'loading')

console.log('== what counts as "no tags"')
check('httpStatus 404', isAbsent({ httpStatus: 404 }))
check('M_NOT_FOUND', isAbsent({ errcode: 'M_NOT_FOUND', httpStatus: 400 }))
check('403 is a failure, not an absence', !isAbsent({ httpStatus: 403, errcode: 'M_FORBIDDEN' }))
check('a network error is a failure', !isAbsent(new TypeError('Failed to fetch')))
check('nothing is not an absence', !isAbsent(undefined))

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
