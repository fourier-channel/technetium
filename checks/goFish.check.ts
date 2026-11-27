// Checks for tc.113: go-fish (CD-10) as one module, src/client/goFish.ts.
//
// Two halves. withRetry, asString and asBool are proven here over injected
// timers, no DOM. The call sites that used to carry the pattern inline are
// React components and a cache reader; that they now go through goFish.ts is
// asserted on their source with comments stripped (a comment naming the call
// is not the call). Neither half proves a browser retries an image; that is
// the media path's own live behaviour.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { asBool, asString, retryDelay, withRetry, type RetryTimers } from '../src/client/goFish.ts'

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

// A clock the check drives: timers fire only when advanced past.
function fakeTimers() {
  let now = 0
  let seq = 0
  const pending = new Map<number, { at: number; fn: () => void }>()
  const waits: number[] = []
  const timers: RetryTimers = {
    setTimeout(fn, ms) { waits.push(ms); const id = ++seq; pending.set(id, { at: now + ms, fn }); return id },
    clearTimeout(h) { pending.delete(h as number) },
  }
  // Microtasks first (the attempt's promise), then any timer now due, repeated.
  async function advance(ms: number) {
    const end = now + ms
    for (;;) {
      for (let i = 0; i < 5; i++) await Promise.resolve()
      const due = [...pending.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      pending.delete(due[0])
      now = due[1].at
      due[1].fn()
    }
    now = end
    for (let i = 0; i < 5; i++) await Promise.resolve()
  }
  return { timers, advance, waits, pending }
}

console.log('\n-- retryDelay: the wait after each failure --')
{
  const p = { maxAttempts: 5, baseDelayMs: 800 }
  check('doubling from the base: 800, 1600, 3200, 6400',
    [1, 2, 3, 4].map((n) => retryDelay(n, p)).join() === '800,1600,3200,6400')
  check('the fifth failure of five spends the budget', retryDelay(5, p) === null)
  check('a fixed interval with factor 1', [1, 2, 3].map((n) => retryDelay(n, { maxAttempts: 9, baseDelayMs: 500, factor: 1 })).join() === '500,500,500')
  check('maxAttempts 1 never retries', retryDelay(1, { maxAttempts: 1, baseDelayMs: 10 }) === null)
}

console.log('\n-- withRetry: bounded, then onGiveUp exactly once --')
await (async () => {
  const t = fakeTimers()
  let calls = 0
  const gaveUp: unknown[] = []
  withRetry(() => { calls++; return Promise.reject(new Error('e' + calls)) }, { maxAttempts: 5, baseDelayMs: 800 }, (e) => gaveUp.push(e), t.timers)
  await t.advance(60_000)
  check('always failing: exactly maxAttempts attempts', calls === 5, calls)
  check('onGiveUp called exactly once', gaveUp.length === 1, gaveUp.length)
  check('with the LAST attempt\'s error', (gaveUp[0] as Error)?.message === 'e5')
  check('the waits between attempts were 800, 1600, 3200, 6400', t.waits.join() === '800,1600,3200,6400', t.waits)
  check('nothing left scheduled after the give-up', t.pending.size === 0)
  await t.advance(600_000)
  check('and nothing runs later', calls === 5 && gaveUp.length === 1)
})()

await (async () => {
  const t = fakeTimers()
  let calls = 0
  let gaveUp = 0
  const run = withRetry(() => (++calls < 3 ? Promise.reject(new Error('x')) : Promise.resolve('ok')), { maxAttempts: 5, baseDelayMs: 100 }, () => gaveUp++, t.timers)
  let got: string | undefined
  void run.value.then((v) => { got = v })
  await t.advance(10_000)
  check('a later success resolves value', got === 'ok', got)
  check('and stops retrying', calls === 3)
  check('and never gives up', gaveUp === 0)
})()

await (async () => {
  const t = fakeTimers()
  let calls = 0
  let gaveUp = 0
  const run = withRetry(() => { calls++; return Promise.reject(new Error('x')) }, { maxAttempts: 5, baseDelayMs: 100 }, () => gaveUp++, t.timers)
  await t.advance(150) // first failure, second attempt, its failure -> a wait is pending
  const before = calls
  run.cancel()
  await t.advance(60_000)
  check('cancel stops further attempts', calls === before, { before, calls })
  check('cancel never gives up', gaveUp === 0)
  check('cancel clears the pending wait', t.pending.size === 0)
})()

await (async () => {
  const t = fakeTimers()
  let gaveUp = 0
  let release: (v: string) => void = () => {}
  const run = withRetry(() => new Promise<string>((r) => { release = r }), { maxAttempts: 3, baseDelayMs: 100 }, () => gaveUp++, t.timers)
  let got: string | undefined
  void run.value.then((v) => { got = v })
  run.cancel()
  release('late')
  await t.advance(10)
  check('an attempt in flight at cancel still hands its value back (so the caller can release it)', got === 'late')
  check('and that is not a give-up', gaveUp === 0)
})()

await (async () => {
  const t = fakeTimers()
  let calls = 0
  let gaveUp = 0
  let fail: (e: Error) => void = () => {}
  const run = withRetry(() => { calls++; return new Promise<string>((_, j) => { fail = j }) }, { maxAttempts: 1, baseDelayMs: 100 }, () => gaveUp++, t.timers)
  run.cancel()
  fail(new Error('late'))
  await t.advance(10_000)
  check('an attempt in flight at cancel that then fails is not a give-up', gaveUp === 0, gaveUp)
  const t2 = fakeTimers()
  let fail2: (e: Error) => void = () => {}
  let calls2 = 0
  const run2 = withRetry(() => { calls2++; return new Promise<string>((_, j) => { fail2 = j }) }, { maxAttempts: 5, baseDelayMs: 100 }, () => {}, t2.timers)
  run2.cancel()
  fail2(new Error('late'))
  await t2.advance(10_000)
  check('nor does it schedule another attempt', calls2 === 1 && t2.pending.size === 0, { calls2 })
  check('the cancelled run made its one attempt', calls === 1)
})()

await (async () => {
  const t = fakeTimers()
  let calls = 0
  const gaveUp: unknown[] = []
  withRetry(() => { calls++; throw new Error('sync') }, { maxAttempts: 2, baseDelayMs: 10 }, (e) => gaveUp.push(e), t.timers)
  await t.advance(1000)
  check('an attempt that throws synchronously counts as a failure', calls === 2 && gaveUp.length === 1)
})()

console.log('\n-- asString / asBool: discard what does not match --')
{
  check('asString keeps a string', asString('a', 'fb') === 'a')
  check('asString keeps an empty string', asString('', 'fb') === '')
  check('asString discards a number', asString(1, 'fb') === 'fb')
  check('asString discards null and undefined', asString(null, null) === null && asString(undefined, 'fb') === 'fb')
  check('asString discards an object and an array', asString({}, 'fb') === 'fb' && asString(['a'], 'fb') === 'fb')
  check('asBool true only for true', asBool(true) === true)
  check('asBool discards "true", 1, {} and false',
    asBool('true') === false && asBool(1) === false && asBool({}) === false && asBool(false) === false)
}

console.log('\n-- the inline sites now go through goFish.ts --')
{
  const ai = code('src/ui/AuthedImage.tsx')
  check('AuthedImage imports withRetry', /import \{[^}]*\bwithRetry\b[^}]*\} from '\.\.\/client\/goFish'/.test(ai))
  check('AuthedImage has no inline backoff left', !/\*\* attemptsRef|retryTick|attemptsRef|MEDIA_MAX_RETRIES/.test(ai))
  check('AuthedImage gives up by reporting once and showing the fallback',
    /\(err\) => \{\s*reportIgnored\(failureScope, err\)\s*setError\(true\)\s*\}/.test(ai))
  check('AuthedImage cancels the run in its cleanup', /run\.cancel\(\)/.test(ai))
  const app = code('src/App.tsx')
  check('openRoomById goes through withRetry', /const openRoomById[\s\S]{0,400}withRetry\(/.test(app))
  check('openRoomById reports its give-up', /const openRoomById[\s\S]{0,900}reportIgnored\('open room by id'/.test(app))
  check('openRoomById has no hand-rolled countdown', !/triesLeft/.test(app))
  const ss = code('src/client/serverShape.ts')
  check('fromShape reads through asString / asBool',
    /name: asString\(o\.name, o\.roomId\)/.test(ss) && /isSpace: asBool\(o\.isSpace\)/.test(ss) &&
      /membership: asString\(o\.membership, null\)/.test(ss) && /joinRule: asString\(o\.joinRule, null\)/.test(ss))
  check('fromShape has no inline typeof ladder left', !/typeof o\.(name|membership|joinRule) === 'string' \?/.test(ss))
  // Kept as they are, on purpose: their comments point at goFish.ts.
  check('readAdminBody stays itself and points at goFish.ts',
    /export function readAdminBody/.test(code('src/client/serverAdmin.ts')) && /goFish\.ts/.test(readFileSync(join(root, 'src/client/serverAdmin.ts'), 'utf8')))
  check('hasImage stays itself and points at goFish.ts',
    /export function hasImage/.test(code('src/onboarding/assets.ts')) && /goFish\.ts/.test(readFileSync(join(root, 'src/onboarding/assets.ts'), 'utf8')))
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
