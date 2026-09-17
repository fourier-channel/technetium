// How scrollback decides it has reached the start of a room.
//
// THE BUG THIS EXISTS FOR. loadOlder used to compare the main timeline's event
// count before and after a page and treat "no growth" as "start of the room".
// That is not what no-growth means. client.scrollback() runs the returned page
// through room.partitionThreadedEvents() and adds ONLY the non-threaded part to
// the live timeline -- thread replies go to processThreadEvents and never touch
// it. A page that happens to be entirely thread replies therefore leaves the
// main timeline exactly as long as it was, while the pagination token is still
// perfectly live and there is plenty of history left.
//
// The consequence was not a missing page, it was a latch: loadOlder checks
// atStart on entry, so once set, scrollback was dead for the rest of that
// room's visit and only switching rooms cleared it. Reported from production as
// "any channel with threads is unable to go back in history".
//
// WHAT THIS CANNOT SEE: it reads source. It proves the decision is made from
// the pagination token and not from a length comparison, and it pins the two
// SDK behaviours the fix depends on. It does NOT prove a real room paginates --
// that needs a server with a threaded room and is an operator check.
import { readFileSync } from 'node:fs'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const timeline = readFileSync('src/client/useTimeline.ts', 'utf8')

// The body of loadOlder, so an assertion cannot be satisfied by some unrelated
// part of the file that happens to mention the same identifier.
const loadOlder = timeline.slice(
  timeline.indexOf('const loadOlder'),
  timeline.indexOf('return { items, loadOlder'),
)

console.log('== the end-of-room decision')
check('loadOlder was found', loadOlder.length > 0)
check('it asks the SDK for the pagination token',
  /paginationToken/.test(loadOlder))
check('reaching the start is decided by that token being null',
  /paginationToken\s*===\s*null/.test(loadOlder))

// The actual regression. Any of these shapes is the old heuristic returning.
console.log('== the heuristic that caused it must not come back')
check('no before/after event-count comparison decides atStart',
  !/const\s+before\b/.test(loadOlder) && !/const\s+after\b/.test(loadOlder),
  'a length comparison cannot see a page that was routed into thread timelines')
check('atStart is never set from an equality between two lengths',
  !/if\s*\(\s*after\s*===\s*before\s*\)/.test(loadOlder))
check('getEvents().length is not consulted in loadOlder at all',
  !/getEvents\(\)\.length/.test(loadOlder))

console.log('== the latch must be cleared when the timeline is replaced')
// A gappy sync swaps the live timeline; the old verdict was about a timeline
// the room no longer owns, and the replacement has its own token. Keeping it
// would switch scrollback off over history that is reachable again.
const onReset = timeline.slice(timeline.indexOf('const onReset'), timeline.indexOf('const onDecrypted'))
check('onReset was found', onReset.length > 0)
check('a timeline reset clears atStart', /setAtStart\(false\)/.test(onReset))

// ---------------------------------------------------------------------------
// The SDK contract the fix rests on. This repo deep-couples to matrix-js-sdk
// internals elsewhere and has been bitten by upgrades; if either behaviour
// below changes, the fix above is silently wrong again and this says so.
// ---------------------------------------------------------------------------
console.log('== matrix-js-sdk contract (pinned deliberately)')
let sdk = ''
try {
  sdk = readFileSync('node_modules/matrix-js-sdk/lib/client.js', 'utf8')
} catch {
  // Not a pass. An unreadable dependency is unmeasured, and unmeasured is
  // never reported as clean.
  failures++
  console.log('  FAIL could not read matrix-js-sdk to verify the contract it rests on')
}

if (sdk) {
  const scrollback = sdk.slice(sdk.indexOf('scrollback(room)'), sdk.indexOf('scrollback(room)') + 3000)
  check('scrollback still partitions threaded events out of the page',
    /partitionThreadedEvents/.test(scrollback),
    'if this is gone, thread replies may now reach the live timeline and the old heuristic was not wrong for the reason stated')
  check('only the non-threaded part is added to the live timeline',
    /addEventsToTimeline\(\s*timelineEvents/.test(scrollback))
  check('the token is set from res.end each page',
    /paginationToken\s*=\s*\(?_?res\$?end/.test(scrollback) || /paginationToken\s*=\s*res\.end/.test(scrollback))
  check('the token is nulled only on an empty chunk',
    /chunk\.length\s*===\s*0/.test(scrollback),
    'the null-token signal is what loadOlder now trusts; if the condition moved, re-read it')
  check('an already-null token short-circuits, so a latched atStart is not needed for correctness',
    /paginationToken\s*===\s*null/.test(scrollback))
}

console.log(failures === 0 ? '\nOK' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
