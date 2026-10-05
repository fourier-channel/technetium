// One tab per device (operator, 2026-10-05: "If the one-tab lock is the shape
// that works, we'll use it"). The precondition for encryption on by default:
// two tabs of one browser are one device, and two engines on one store can
// leave messages unreadable for good.
//
// Driven here by a MODEL of the Web Locks API -- ifAvailable answers null when
// held; steal hands the lock over and rejects the old holder's request with an
// AbortError -- and by the real API in Chromium in tools/visual/devicelock.sh,
// which is where the model is checked against the browser.
import { readFileSync } from 'node:fs'
import {
  ACK_TIMEOUT_MS,
  acquireDeviceLock,
  deviceElsewhereCopy,
  deviceLockName,
  type ChannelLike,
  type LockManagerLike,
} from '../src/client/deviceLock.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const tick = () => new Promise((r) => setTimeout(r, 0))

// The browser's lock manager, as the spec describes the two modes used.
class ModelLocks implements LockManagerLike {
  holders = new Map<string, { reject: (e: unknown) => void }>()
  async query() { return { held: [...this.holders.keys()].map((name) => ({ name })) } }
  request(name: string, opts: { ifAvailable?: boolean; steal?: boolean }, cb: (lock: unknown) => unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const held = this.holders.get(name)
      if (held && opts.ifAvailable) {
        Promise.resolve(cb(null)).then(resolve, reject)
        return
      }
      if (held && opts.steal) {
        this.holders.delete(name)
        const e = new Error('The lock request is aborted.')
        e.name = 'AbortError'
        held.reject(e)
      } else if (held) {
        // Neither option: the request QUEUES until the holder lets go -- the
        // browser's default, and the one a busy tab must never use.
        const q = this.queue.get(name) ?? []
        q.push(() => this.grant(name, cb, resolve, reject))
        this.queue.set(name, q)
        return
      }
      this.grant(name, cb, resolve, reject)
    })
  }
  queue = new Map<string, (() => void)[]>()
  private grant(name: string, cb: (lock: unknown) => unknown, resolve: (v: unknown) => void, reject: (e: unknown) => void) {
    const entry = { reject }
    this.holders.set(name, entry)
    const free = () => {
      if (this.holders.get(name) !== entry) return
      this.holders.delete(name)
      this.queue.get(name)?.shift()?.()
    }
    Promise.resolve(cb({ name })).then((v) => { free(); resolve(v) }, (e) => { free(); reject(e) })
  }
}

// A BroadcastChannel: every channel on the bus hears every other.
function bus() {
  const open = new Set<{ l: Set<(ev: { data: unknown }) => void> }>()
  return (): ChannelLike => {
    const me = { l: new Set<(ev: { data: unknown }) => void>() }
    open.add(me)
    return {
      postMessage: (data) => { for (const o of open) if (o !== me) for (const f of o.l) queueMicrotask(() => f({ data })) },
      addEventListener: (_t, f) => { me.l.add(f) },
      removeEventListener: (_t, f) => { me.l.delete(f) },
      close: () => { open.delete(me) },
    }
  }
}

const NAME = deviceLockName('@saber:41chan.net', 'DEVICEA')

console.log('== one tab holds the device; a second is told it is busy')
{
  const locks = new ModelLocks()
  const openChannel = bus()
  let lostA = 0
  const a = await acquireDeviceLock({ locks, name: NAME, steal: false, onLost: () => { lostA++ }, openChannel })
  check('the first tab gets it', a.kind === 'held', a)
  const b = await Promise.race([
    acquireDeviceLock({ locks, name: NAME, steal: false, onLost: () => {}, openChannel }),
    new Promise<{ kind: 'still waiting in the queue' }>((r) => setTimeout(() => r({ kind: 'still waiting in the queue' }), 50)),
  ])
  check('the second is busy, at once (no waiting in a queue)', b.kind === 'busy', b)
  check('and asking does not disturb the first', lostA === 0 && locks.holders.has(NAME))
  const other = await acquireDeviceLock({ locks, name: deviceLockName('@saber:41chan.net', 'DEVICEB'), steal: false, onLost: () => {}, openChannel })
  check('another device (another sign-in, another profile) is not blocked by it', other.kind === 'held', other)

  console.log('== "Use it here": the second takes it, the first stops first')
  const order: string[] = []
  let wantedMs = -1
  const c = acquireDeviceLock({
    locks, name: NAME, steal: true, onLost: () => {}, openChannel,
    wait: (ms, until) => { wantedMs = ms; return until.then(() => { order.push('new tab heard the stop') }) },
  })
  // The first tab's onLost is what stops its client: record when it runs.
  // (Re-acquire A with an onLost that records, so the order is observable.)
  void c
  await tick()
  check('the first tab is told it lost the device, once', lostA === 1, lostA)
  const cr = await c
  check('the new tab holds it', cr.kind === 'held', cr)
  check('and waited for the old tab\'s word, with the timeout as its ceiling', wantedMs === ACK_TIMEOUT_MS && order.includes('new tab heard the stop'), { wantedMs, order })
}

console.log('== the stop comes BEFORE the new tab starts')
{
  const locks = new ModelLocks()
  const openChannel = bus()
  const order: string[] = []
  // The old tab's channel records when it announces, so "stopped, THEN
  // said so" is observable, not just "said so at some point".
  const oldTabChannel = () => { const c = openChannel(); return { ...c, postMessage: (m: unknown) => { order.push('old tab announced'); c.postMessage(m) } } }
  await acquireDeviceLock({ locks, name: NAME, steal: false, onLost: () => { order.push('old tab stopped its client') }, openChannel: oldTabChannel })
  const r = await acquireDeviceLock({ locks, name: NAME, steal: true, onLost: () => {}, openChannel, wait: (_ms, until) => until })
  order.push('new tab starts')
  check('old tab stopped, then said so, then the new tab started',
    r.kind === 'held' && order.join(' > ') === 'old tab stopped its client > old tab announced > new tab starts', order)
}

console.log('== a tab that never answers (frozen, closed) does not hold the new one forever')
{
  const locks = new ModelLocks()
  await acquireDeviceLock({ locks, name: NAME, steal: false, onLost: () => {}, openChannel: () => null })
  let waited = -1
  const r = await acquireDeviceLock({ locks, name: NAME, steal: true, onLost: () => {}, openChannel: bus(), wait: async (ms) => { waited = ms } })
  check('the new tab goes on after the timeout', r.kind === 'held' && waited === ACK_TIMEOUT_MS, { r, waited })
}

console.log('== taking a FREE device does not wait for anybody')
{
  const locks = new ModelLocks()
  let waited = false
  const r = await acquireDeviceLock({ locks, name: NAME, steal: true, onLost: () => {}, openChannel: bus(), wait: async () => { waited = true } })
  check('held, no wait', r.kind === 'held' && !waited, { r, waited })
}

console.log('== logout releases it, and a release is not a loss')
{
  const locks = new ModelLocks()
  let lost = 0
  const a = await acquireDeviceLock({ locks, name: NAME, steal: false, onLost: () => { lost++ }, openChannel: bus() })
  if (a.kind === 'held') a.release()
  await tick()
  check('released: the lock is free', !locks.holders.has(NAME))
  check('and the tab that let go is not told it lost it', lost === 0, lost)
  const b = await acquireDeviceLock({ locks, name: NAME, steal: false, onLost: () => {}, openChannel: bus() })
  check('the next tab gets it without a takeover', b.kind === 'held')
  if (a.kind === 'held') a.release()
  check('a second release is harmless', locks.holders.has(NAME))
}

console.log('== no Web Locks')
{
  const r = await acquireDeviceLock({ locks: undefined, name: NAME, steal: false, onLost: () => {} })
  check('is "unsupported", with the reason', r.kind === 'unsupported' && /Web Locks/.test(r.why), r)
  const throwing: LockManagerLike = { request: () => { throw new Error('SecurityError') } }
  const t = await acquireDeviceLock({ locks: throwing, name: NAME, steal: false, onLost: () => {} })
  check('a request the browser refuses outright is "unsupported", never "busy"', t.kind === 'unsupported', t)
}

console.log('== what the screens say')
for (const w of ['busy', 'taken'] as const) {
  const c = deviceElsewhereCopy(w)
  check(`${w}: a title, a reason, and "Use it here"`, c.title.length > 0 && /only one tab|took over/.test(c.body) && c.action === 'Use it here', c)
  check(`${w}: says the other tab stops, and is ASCII`, /the other tab stops/.test(c.body) && /^[\x20-\x7e]+$/.test(c.title + c.body))
}
check('the lock is per user AND device', deviceLockName('@a:x', 'D1') !== deviceLockName('@a:x', 'D2') && deviceLockName('@a:x', 'D1') !== deviceLockName('@b:x', 'D1'))

console.log('== wired in, read from source')
{
  const ctx = read('src/client/ClientContext.tsx')
  const start = ctx.slice(ctx.indexOf('const startSyncedClient = async'), ctx.indexOf('// Read the account\'s encryption identity'))
  check('the device is taken BEFORE the client is built', start.indexOf('acquireDeviceLock(') > 0 && start.indexOf('acquireDeviceLock(') < start.indexOf('await buildClient('))
  check('a busy device starts nothing: the busy screen, and return', /if \(got\.kind === 'busy'\) \{\s*\n\s*setStatus\('device_busy'\)\s*\n\s*return\s*\n\s*\}/.test(start))
  check('taken whatever the encryption setting (a tab with no engine still eats room keys)',
    !/if \(e2eeEnabled\(\)\) \{[^}]*acquireDeviceLock/.test(start))
  check('a start overtaken by a takeover stops the client it built',
    (start.match(/if \(!stillOurs\(\)\) \{ c\.stopClient\(\); clientRef\.current = null; return \}/g) ?? []).length === 2)
  const lost = ctx.slice(ctx.indexOf('const onDeviceLost = () => {'), ctx.indexOf('// Shared: build the persistent-store client'))
  check('losing the device stops the client synchronously and shows the taken screen',
    /clientRef\.current\?\.stopClient\(\)/.test(lost) && /setStatus\('device_taken'\)/.test(lost) && !/queueMicrotask|await/.test(lost))
  check('and keeps the session: no clear, no cache drop, no sign-out', !/clearSession|deleteSyncStore|endSession/.test(lost))
  const end = ctx.slice(ctx.indexOf('function endSession('), ctx.indexOf('const logout ='))
  check('every ending releases the device', /lockRef\.current\?\.release\(\)/.test(end))
  check('"Use it here" resumes from the record read afresh, stealing', /takeOverDevice: \(\) => \{ void resumeSession\(true\) \}/.test(ctx) &&
    /async function resumeSession\(steal = false\) \{\s*\n\s*const s = loadSession\(\)/.test(ctx) && /confirmDevice: true,\s*\n\s*steal,/.test(ctx))
  const app = read('src/App.tsx')
  check('both statuses get the screen', /if \(status === 'device_busy' \|\| status === 'device_taken'\) \{\s*\n\s*return <DeviceElsewhere which=\{status === 'device_busy' \? 'busy' : 'taken'\} \/>/.test(app))
  const screen = read('src/ui/DeviceElsewhere.tsx')
  check('the screen has no purge (it would pull the live tab\'s state from under it)', !/<SiteReset/.test(screen))
}

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\ndevice lock: all checks passed')
