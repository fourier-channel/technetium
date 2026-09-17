// How the timeline pages backwards, and why it cannot use client.scrollback().
//
// THE BUG THIS EXISTS FOR. Paging back did nothing in any room with a thread.
// Two faults stacked, and the first one hid the second.
//
// 1. client.scrollback() NEVER FETCHED ANYTHING IN THIS CLIENT. It reads
//    room.oldState.paginationToken -- a field on RoomState maintained only by
//    the legacy /sync path. This client runs sliding sync, which sets the
//    backward token on the TIMELINE instead:
//        room.getLiveTimeline().setPaginationToken(prev_batch, BACKWARDS)
//    RoomState.paginationToken therefore stays at its initial null, and
//    scrollback's first guard returns "already at the start" without issuing a
//    request. Both the initial deepening and every Load-older click were
//    no-ops, so a room only ever showed its sliding-sync window.
//
// 2. A PAGE CAN LEGITIMATELY ADD NOTHING VISIBLE. The SDK partitions each page
//    with partitionThreadedEvents and routes thread replies into their own
//    thread timelines, so in a thread-heavy room a full page of 30 lands out of
//    the main timeline. Deciding "start of the room" from the main timeline not
//    growing -- which the first version of this fix still did -- reads a normal
//    page as the end of history and latches scrollback off.
//
// The fix paginates the timeline directly, believes the boolean the SDK
// returns, and keeps paging (bounded) while nothing lands.
//
// WHAT THIS CANNOT SEE: it reads source. It proves the call, the termination
// signal and the bound are the right ones, and it pins the SDK behaviours the
// reasoning rests on. It does NOT prove a real room pages -- that needs a
// server with threaded history and is an operator check.
import { readFileSync } from 'node:fs'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

// Assertions about CODE must not be satisfied -- or broken -- by prose. The
// comments in useTimeline.ts necessarily NAME the calls this check forbids,
// explaining why they are wrong; matching raw source made three assertions
// fire on their own explanation. Strip comments first.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const timelineRaw = readFileSync('src/client/useTimeline.ts', 'utf8')
const timeline = stripComments(timelineRaw)
const loadOlder = timeline.slice(
  timeline.indexOf('const loadOlder'),
  timeline.indexOf('return { items, loadOlder'),
)

console.log('== the call that actually fetches')
check('loadOlder was found', loadOlder.length > 0)
check('loadOlder paginates the timeline',
  /paginateEventTimeline\(/.test(loadOlder))
check('it paginates BACKWARDS', /backwards:\s*true/.test(loadOlder))
check('client.scrollback is not used anywhere in this file',
  !/client\.scrollback\(/.test(timeline),
  'scrollback reads room.oldState.paginationToken, which sliding sync never sets')

console.log('== the end-of-room decision')
check('atStart comes from the boolean the SDK returns',
  /if\s*\(\s*!more\s*\)\s*setAtStart\(true\)/.test(loadOlder))
check('no before/after length comparison decides atStart',
  !/if\s*\(\s*after\s*===\s*before\s*\)/.test(loadOlder))
check('the old oldState token test is gone',
  !/oldState\.paginationToken/.test(loadOlder))

console.log('== a page that lands nothing must not stop the walk')
// THE SECOND PRODUCTION FAILURE. Paging was fixed, the request fired, the
// timeline grew -- and the screen did not change, so the button flicked to
// Loading and back. Roughly two thirds of a busy room's events are
// net.41chan.* system events that are never drawn, and they arrive in runs,
// so a full page can contain no visible item at all. Counting timeline events
// asks the wrong question; the walk has to continue until something RENDERS.
check('the walk is driven by the RENDERED item count',
  /while\s*\(.*more.*buildItems\(\)\.length\s*===\s*before/.test(loadOlder.replace(/\s+/g, ' ')))
check('the loop does NOT decide from the timeline event count',
  !/getEvents\(\)\.length\s*===\s*before/.test(loadOlder),
  'a page of purely filtered events grows the timeline and shows nothing')
check('the before-count is the rendered one too',
  /const before = buildItems\(\)\.length/.test(loadOlder))
check('buildItems is shared with refresh rather than reimplemented',
  /const buildItems = useCallback/.test(timeline) && /setItems\(applyLayout\(buildItems\(\)\)\)/.test(timeline))
check('and the walk is bounded', /MAX_PAGES/.test(loadOlder) && /const MAX_PAGES\s*=\s*\d+/.test(timeline))
check('the page size is a named constant, not a literal',
  /limit: PAGE_SIZE/.test(loadOlder) && /const PAGE_SIZE\s*=\s*\d+/.test(timeline))

console.log('== the initial deepening has the same problem and the same fix')
// Anchored on code, since the comments that named these spots are stripped.
const effect = timeline.slice(timeline.indexOf('INITIAL_SCROLLBACK) {'), timeline.indexOf('const onTimeline'))
check('initial deepening was found', effect.length > 0)
check('it paginates rather than calling scrollback',
  /paginateEventTimeline\(/.test(effect) && !/scrollback\(room/.test(effect))

// ---------------------------------------------------------------------------
// The SDK behaviours the reasoning rests on. This repo deep-couples to
// matrix-js-sdk internals and has been bitten by upgrades; if any of these
// change, the argument above is stale and this says so rather than letting a
// silent no-op come back.
// ---------------------------------------------------------------------------
console.log('== matrix-js-sdk contract (pinned deliberately)')
let client = ''
let roomState = ''
let slidingSync = ''
try {
  client = readFileSync('node_modules/matrix-js-sdk/lib/client.js', 'utf8')
  roomState = readFileSync('node_modules/matrix-js-sdk/lib/models/room-state.js', 'utf8')
  slidingSync = readFileSync('node_modules/matrix-js-sdk/lib/sliding-sync-sdk.js', 'utf8')
} catch {
  // Unmeasured is never reported as clean.
  failures++
  console.log('  FAIL could not read matrix-js-sdk to verify the contract this rests on')
}

if (client && roomState && slidingSync) {
  const scrollback = client.slice(client.indexOf('scrollback(room)'), client.indexOf('scrollback(room)') + 3000)
  check('scrollback still short-circuits on a null oldState token',
    /oldState\.paginationToken === null/.test(scrollback),
    'this is why it never fetched; if it changed, re-read the whole argument')
  check('RoomState.paginationToken still defaults to null',
    /_defineProperty\(this, "paginationToken", null\)/.test(roomState))
  check('sliding sync still sets the backward token on the TIMELINE',
    /getLiveTimeline\(\)\.setPaginationToken\(/.test(slidingSync))
  check('sliding sync still does NOT set oldState.paginationToken',
    !/oldState\.paginationToken\s*=/.test(slidingSync),
    'if it started doing so, scrollback would work and this fix could be simplified')
  check('paginateEventTimeline still reads the token off the timeline',
    /var token = eventTimeline\.getPaginationToken\(dir\)/.test(client))
  check('it still resolves false only at the end of the timeline',
    /resolves to a boolean: false if there are no\s*\*\s*events and we reached either end/.test(client))
  check('scrollback still partitions threaded events out of the page',
    /partitionThreadedEvents/.test(scrollback),
    'the reason a page can add nothing to the main timeline')
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
