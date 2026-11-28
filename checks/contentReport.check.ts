// Checks for ing.67's Technetium half: Report a message, src/client/contentReport.ts.
//
// Proven here, with no DOM and no homeserver: who may report what (over the
// whole small input space), the reason as sent, the words shown on a refusal,
// and that the one call goes out as reportEvent(roomId, eventId, -100, reason)
// with its `this`. Asserted on source: the action bar offers it and the dialog
// shows only those words.
//
// WHAT THIS CANNOT SEE: that Synapse stores the report (event_reports), or
// that anything carries it to the moderators. Those are the live proof.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  REPORT_REASON_MAX, REPORT_SCORE, mayReport, reportFailureText, reportReason, sendReport,
} from '../src/client/contentReport.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const code = (path: string) =>
  readFileSync(join(root, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

console.log('\n-- mayReport: someone else\'s real message, already on the server --')
{
  const kinds = ['message', 'gallery', 'redacted', 'encrypted', 'state', 'membership', 'notice', '']
  const ids = ['$abc', '~local1', '']
  const people = ['@a:x', '@b:x', null]
  let allowed = 0
  let wrong: unknown[] = []
  for (const kind of kinds) for (const eventId of ids) for (const sender of people) for (const me of people) {
    const got = mayReport({ kind, eventId, sender, me })
    const want = (kind === 'message' || kind === 'gallery') && eventId === '$abc'
      && sender !== null && me !== null && sender !== me
    if (got) allowed++
    if (got !== want) wrong.push({ kind, eventId, sender, me, got })
  }
  check('agrees with the rule on all ' + kinds.length * ids.length * 9 + ' combinations', wrong.length === 0, wrong.slice(0, 3))
  check('and the rule allows something (a predicate that is always false passes nothing)', allowed === 4, allowed)
  wrong = []
  check('your own message is not reportable', !mayReport({ kind: 'message', eventId: '$e', sender: '@a:x', me: '@a:x' }))
  check('a local echo is not reportable', !mayReport({ kind: 'message', eventId: '~1', sender: '@b:x', me: '@a:x' }))
  check('a redacted row is not reportable', !mayReport({ kind: 'redacted', eventId: '$e', sender: '@b:x', me: '@a:x' }))
}

console.log('\n-- reportReason: trimmed and capped --')
{
  check('trimmed', reportReason('  spam  \n') === 'spam')
  check('empty stays empty (the reason is optional)', reportReason('   ') === '')
  const long = 'x'.repeat(REPORT_REASON_MAX + 50)
  check('capped at REPORT_REASON_MAX', reportReason(long).length === REPORT_REASON_MAX)
  const emoji = '\u{1F600}'.repeat(REPORT_REASON_MAX + 5)
  const capped = reportReason(emoji)
  check('the cap counts code points and never leaves a lone surrogate',
    Array.from(capped).length === REPORT_REASON_MAX && !/[\uD800-\uDBFF]$/.test(capped))
  check('the cap is the documented 1000', REPORT_REASON_MAX === 1000)
}

console.log('\n-- reportFailureText: plain words, never the raw error --')
{
  const cases: [unknown, RegExp][] = [
    [{ httpStatus: 429, errcode: 'M_LIMIT_EXCEEDED' }, /Too many reports/],
    [{ errcode: 'M_LIMIT_EXCEEDED' }, /Too many reports/],
    [{ httpStatus: 404, errcode: 'M_NOT_FOUND' }, /can no longer be reported/],
    [{ httpStatus: 403, errcode: 'M_FORBIDDEN' }, /rooms you are in/],
    [new Error('connect ECONNREFUSED 10.0.0.5:8008'), /did not go through/],
    [null, /did not go through/],
    ['boom', /did not go through/],
  ]
  for (const [err, re] of cases) {
    const t = reportFailureText(err)
    check(`${JSON.stringify(err instanceof Error ? err.message : err)} -> ${re}`, re.test(t), t)
  }
  const raw = reportFailureText(new Error('https://matrix.example:8448/_matrix M_UNKNOWN'))
  check('no address, port or errcode in the words shown', !/https?:|\d+\.\d+\.\d+|:\d{2,5}\b|M_[A-Z]/.test(raw), raw)
}

console.log('\n-- sendReport: the one call that leaves --')
await (async () => {
  const calls: unknown[][] = []
  const client = {
    tag: 'me',
    reportEvent(this: { tag: string }, ...args: unknown[]) {
      calls.push([this?.tag, ...args])
      return Promise.resolve({})
    },
  }
  await sendReport(client, '!r:x', '$e', '  rude  ')
  check('reportEvent called once', calls.length === 1, calls.length)
  check('as a method, keeping its this (G-bf03)', calls[0][0] === 'me')
  check('with room, event, the fixed score and the trimmed reason',
    JSON.stringify(calls[0].slice(1)) === JSON.stringify(['!r:x', '$e', -100, 'rude']), calls[0])
  check('the fixed score is the spec\'s -100', REPORT_SCORE === -100)
  let rejected = false
  await sendReport({ reportEvent: () => Promise.reject(new Error('x')) }, '!r:x', '$e', '').catch(() => { rejected = true })
  check('a refusal reaches the caller (the dialog shows it)', rejected)
})()

console.log('\n-- the action bar offers it; the dialog shows only those words --')
{
  const mv = code('src/ui/MessageVerbs.tsx')
  check('MessageVerbs builds a report verb through mayReport',
    /mayReport\(\{ kind: item\.kind, eventId: item\.id, sender: item\.event\.getSender\(\) \?\? null, me: myUserId \}\)/.test(mv))
  check('and opens ReportDialog', /<ReportDialog client=\{client\} target=\{reporting\}/.test(mv))
  const rd = code('src/ui/ReportDialog.tsx')
  check('the dialog sends through sendReport', /sendReport\(client, roomId, eventId, reason\)/.test(rd))
  check('a failure is reported to the console and shown in plain words',
    /reportIgnored\('report a message', err\)\s*setStage\(\{ s: 'failed', text: reportFailureText\(err\) \}\)/.test(rd))
  check('the dialog never renders the error object itself', !/\{\s*String\(err|\{err\b|err\.message/.test(rd))
  check('the reason box is capped at the same number', /maxLength=\{REPORT_REASON_MAX\}/.test(rd))
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
