// Checks for the media fetch limiter.
//
// The failure this guards is not "too many at once" -- it is a limiter that
// leaks slots. A task that throws must give its slot back, or every failure
// permanently shrinks the pool and enough of them stop media loading with no
// error anywhere.
import { createLimiter } from '../src/client/concurrency.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

// A task whose completion the test controls.
function deferred() {
  let resolve!: (v: string) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<string>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const settle = () => new Promise((r) => setImmediate(r))

console.log('\n-- the cap holds --')
{
  const lim = createLimiter(2)
  const d = [deferred(), deferred(), deferred(), deferred()]
  const runs = d.map((x) => lim.run(() => x.promise))
  runs.forEach((r) => void r.catch(() => {}))
  await settle()

  check('only `max` run at once', lim.stats().active === 2, lim.stats())
  check('the rest wait', lim.stats().waiting === 2, lim.stats())

  d[0].resolve('a')
  await settle()
  check('finishing one admits exactly one more', lim.stats().active === 2 && lim.stats().waiting === 1,
    lim.stats())

  d[1].resolve('b'); d[2].resolve('c'); d[3].resolve('d')
  await settle()
  check('the queue drains to empty', lim.stats().active === 0 && lim.stats().waiting === 0,
    lim.stats())
}

console.log('\n-- a failing task returns its slot --')
{
  const lim = createLimiter(1)
  const bad = deferred()
  const p = lim.run(() => bad.promise)
  void p.catch(() => {})
  await settle()
  bad.reject(new Error('boom'))
  await settle()
  check('a rejected task frees its slot', lim.stats().active === 0, lim.stats())

  // And the limiter still works afterwards -- the real symptom of a leak is
  // that everything AFTER a failure quietly stops.
  const ok = deferred()
  const q = lim.run(() => ok.promise)
  await settle()
  check('the limiter still admits work after a failure', lim.stats().active === 1, lim.stats())
  ok.resolve('fine')
  check('and it resolves through', (await q) === 'fine')
}

console.log('\n-- newest first --')
{
  // LIFO, because requests arrive in scroll order and the newest is the one
  // most likely to be on screen. FIFO would serve what the reader has already
  // scrolled past before what is under their eyes.
  const lim = createLimiter(1)
  const blocker = deferred()
  void lim.run(() => blocker.promise).catch(() => {})
  await settle()

  const order: string[] = []
  const rest = ['first', 'second', 'third'].map((tag) =>
    lim.run(async () => { order.push(tag); return tag }),
  )
  await settle()
  check('queued work has not started', order.length === 0, order)

  blocker.resolve('done')
  await Promise.all(rest)
  check('the most recent request is served first', order[0] === 'third', order)
  check('everything queued still runs', order.length === 3, order)
}

console.log('\n-- degenerate caps --')
{
  check('a cap of zero still runs one', createLimiter(0).stats().active === 0)
  const lim = createLimiter(0)
  const d = deferred()
  void lim.run(() => d.promise).catch(() => {})
  await settle()
  check('a zero cap is clamped to one, not to a deadlock', lim.stats().active === 1, lim.stats())
  d.resolve('x')
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
