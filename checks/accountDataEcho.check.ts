// The ticker's collapse and the layout store write through echoSync (tc.110).
// Before, each wrote per change with a bare catch: tickerCollapse swallowed a
// failure with `.catch(() => {})`, and the layout's drag save and presets save
// wrote independently with a console.warn. This drives the two writers' OWN
// specs (ui/tickerEcho.ts, ui/layoutEcho.ts) through makeEchoSync against a
// fake server that behaves like matrix-js-sdk 41.6's setAccountData in the way
// that matters: a write whose content deep-equals the LOCAL store resolves at
// once and sends nothing, and the local store learns only by echo.
//
// The control (section 0) runs the naive per-click writer the ticker used to
// be against the same fake and asserts it LOSES the last click. Without that,
// a green below could mean only that the fake never reproduces the bug.
//
// WHAT THIS CANNOT SEE: the hooks' React wiring (accountDataEcho.ts,
// tickerCollapse.ts, spaceState.ts) against a live homeserver -- source checks
// below hold the wiring's shape; the behaviour on a throttled connection is
// the operator's.
import { readFileSync } from 'node:fs'
import { makeEchoSync, ECHO_WAIT_MS, type EchoSync } from '../src/client/echoSync.ts'
import type { AccountDataSpec } from '../src/client/accountDataEcho.ts'
import { TICKER_ECHO, TICKER_EVENT } from '../src/ui/tickerEcho.ts'
import { LAYOUT_ECHO, LAYOUT_EVENT } from '../src/ui/layoutEcho.ts'
import { putPreset, setMobilePreset, type LayoutStore } from '../src/ui/presets.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0))
const json = (v: unknown) => JSON.stringify(v)

// A server, a local store that learns only by echo, and hands on every step.
function world(initial: Record<string, unknown> | undefined) {
  let server = initial
  let store = initial
  let puts = 0
  const queue: { content: Record<string, unknown>; resolve: () => void; reject: (e: unknown) => void }[] = []
  const timers: { fn: () => void; at: number }[] = []
  let now = 0
  let heard: () => void = () => {}
  const w = {
    get server() { return server },
    get puts() { return puts },
    queued: () => queue.length,
    read: () => store,
    // setAccountData as the SDK does it, equal-write skip included.
    put: (content: Record<string, unknown>): Promise<unknown> => {
      if (json(store) === json(content)) return Promise.resolve({})
      puts++
      return new Promise<unknown>((resolve, reject) => queue.push({ content, resolve: () => resolve({}), reject }))
    },
    later: (fn: () => void, ms: number) => { timers.push({ fn, at: now + ms }) },
    land: async () => {
      const q = queue.shift()!
      server = q.content
      q.resolve()
      await tick()
    },
    fail: async () => {
      queue.shift()!.reject(new Error('network'))
      await tick()
    },
    echo: async () => {
      store = server
      heard()
      await tick()
    },
    elsewhere: async (content: Record<string, unknown>) => {
      server = content
      await w.echo()
    },
    advance: async (ms: number) => {
      now += ms
      for (const t of timers.splice(0)) if (t.at <= now) t.fn(); else timers.push(t)
      await tick()
    },
    settle: async () => {
      while (queue.length) { await w.land(); await w.echo() }
    },
    onEcho: (fn: () => void) => { heard = fn },
  }
  return w
}

// The writer under test, built exactly as accountDataEcho.ts builds it from a
// spec, with the fake in place of the client.
function start<T>(w: ReturnType<typeof world>, spec: AccountDataSpec<T>) {
  const sync: EchoSync<T> = makeEchoSync<T>({
    ...spec,
    read: w.read,
    write: (v) => w.put(spec.content(v)),
    later: w.later,
  })
  w.onEcho(() => sync.onStored())
  const seen: T[] = []
  sync.subscribe(() => seen.push(sync.snapshot()))
  return { sync, seen }
}

// Reports from echoSync go to console.error; count them instead of printing.
const reports: string[] = []
const realError = console.error
const realWarn = console.warn
console.error = (...a: unknown[]) => { reports.push(a.map(String).join(' ')) }
console.warn = (...a: unknown[]) => { reports.push(a.map(String).join(' ')) }

const collapsed = (c: Record<string, unknown> | undefined) => c?.collapsed === true

console.log('\n-- 0: control -- the old per-click writer loses the last click on this fake --')
{
  const w = world({ collapsed: false })
  // tickerCollapse.ts before tc.110: one setAccountData per click.
  const naive = (v: boolean) => { void w.put({ collapsed: v }).catch(() => {}) }
  naive(true); naive(false) // open, shut, fast
  await w.settle()
  check('the fake skips the second write and the server ends collapsed, against the last click',
    collapsed(w.server) === true && w.puts === 1, { server: w.server, puts: w.puts })
}

console.log('\n-- 1: the ticker, folded and unfolded fast --')
{
  const w = world({ collapsed: false })
  const { sync, seen } = start(w, TICKER_ECHO)
  sync.update(() => true); sync.update(() => false)
  check('the screen shows the last click at once', sync.snapshot() === false)
  check('one write at a time (or none: the store already says it)', w.queued() <= 1, w.queued())
  await w.settle()
  check('the server ends open, as the last click said', collapsed(w.server) === false, w.server)
  check('and the screen agrees', sync.snapshot() === false)

  const w2 = world({ collapsed: false })
  const t2 = start(w2, TICKER_ECHO)
  t2.sync.update(() => true); t2.sync.update(() => false); t2.sync.update(() => true)
  check('three clicks: still only one write in flight', w2.queued() === 1, w2.queued())
  await w2.land(); await w2.echo()
  await w2.settle()
  check('the server ends collapsed after open-shut-open', collapsed(w2.server) === true, w2.server)
  check('the screen never showed open after the last click', t2.seen.at(-1) === true, t2.seen)
  void seen
}

console.log('\n-- 2: the ticker, a write that fails --')
{
  const w = world({ collapsed: false })
  const { sync } = start(w, TICKER_ECHO)
  const before = reports.length
  sync.update(() => true)
  await w.fail()
  check('the fold is undone on screen', sync.snapshot() === false)
  check('and reported, naming the ticker', reports.length > before && reports.slice(before).some((r) => /ticker/.test(r)), reports.slice(before))
}

console.log('\n-- 3: the ticker reads what is stored --')
{
  check('nothing stored is the open ticker', TICKER_ECHO.empty === false)
  check('collapsed: true reads collapsed', TICKER_ECHO.parse({ collapsed: true }) === true)
  check('anything else in an object reads open', TICKER_ECHO.parse({ collapsed: 'yes' }) === false && TICKER_ECHO.parse({}) === false)
  check('a stored non-object is refused for echoSync to report', TICKER_ECHO.parse('x') === null)
  check('it writes the content the hook declares', json(TICKER_ECHO.content(true)) === json({ collapsed: true }))
  check('under its own event type', TICKER_ECHO.type === TICKER_EVENT && TICKER_EVENT === 'net.41chan.tc.ticker')
}

const L = (code: string): LayoutStore => ({ ...LAYOUT_ECHO.empty, code })

console.log('\n-- 4: the layout, a drag that saves several numbers in a row --')
{
  const w = world(LAYOUT_ECHO.content(L('1')))
  const { sync, seen } = start(w, LAYOUT_ECHO)
  for (const code of ['2', '3', '4', '5']) sync.update((cur) => ({ ...cur, code }))
  check('one write in flight, however many saves', w.queued() === 1, w.queued())
  check('the screen holds the last number', sync.snapshot().code === '5')
  await w.land(); await w.echo()
  check('the first save\'s echo does not move the screen back', sync.snapshot().code === '5', sync.snapshot().code)
  await w.settle()
  check('the server ends on the last number', (w.server as { code?: string }).code === '5', w.server)
  check('in two writes, not four', w.puts === 2, w.puts)
  check('nothing between the last save and the end showed an earlier number',
    seen.slice(seen.findIndex((s) => s.code === '5')).every((s) => s.code === '5'), seen.map((s) => s.code))
}

console.log('\n-- 5: the layout, back to a number the stale store still holds --')
{
  // The SDK shortcut: 1 -> 2 -> 1 fast. The first write's echo has not come,
  // so the local store still says 1 and a bare write of 1 would send nothing.
  const w = world(LAYOUT_ECHO.content(L('1')))
  const { sync } = start(w, LAYOUT_ECHO)
  sync.update((cur) => ({ ...cur, code: '2' }))
  sync.update((cur) => ({ ...cur, code: '1' }))
  await w.land(); await w.echo()
  await w.settle()
  check('the server ends on 1, as the last save said', (w.server as { code?: string }).code === '1', w.server)
}

console.log('\n-- 6: the layout, a preset saved during a drag --')
{
  const w = world(LAYOUT_ECHO.content(L('1')))
  const { sync } = start(w, LAYOUT_ECHO)
  sync.update((cur) => ({ ...cur, code: '2' }))
  // A preset, pointed at phones, while the drag's save is on its way.
  sync.update((cur) => setMobilePreset(putPreset(cur, 'Phone', '77'), 'Phone'))
  sync.update((cur) => ({ ...cur, code: '3' }))
  await w.settle()
  const s = LAYOUT_ECHO.parse(w.server)!
  check('the server keeps the preset and the device pointer', s.presets.some((p) => p.name === 'Phone' && p.code === '77') && s.mobilePreset === 'Phone', s)
  check('and the last number', s.code === '3', s.code)
}

console.log('\n-- 7: the layout, a write that fails, and an echo that never comes --')
{
  const w = world(LAYOUT_ECHO.content(L('1')))
  const { sync } = start(w, LAYOUT_ECHO)
  const before = reports.length
  sync.update((cur) => ({ ...cur, code: '2' }))
  await w.fail()
  check('the change is undone on screen', sync.snapshot().code === '1', sync.snapshot().code)
  check('and reported, naming the layout', reports.slice(before).some((r) => /layout/.test(r)), reports.slice(before))

  const w2 = world(LAYOUT_ECHO.content(L('1')))
  const t2 = start(w2, LAYOUT_ECHO)
  t2.sync.update((cur) => ({ ...cur, code: '2' }))
  await w2.land() // accepted; no echo
  t2.sync.update((cur) => ({ ...cur, code: '3' }))
  check('the next save waits for the echo', w2.queued() === 0, w2.queued())
  await w2.advance(ECHO_WAIT_MS)
  check('but not past the deadline', w2.queued() === 1, w2.queued())
  await w2.settle()
  check('and the server ends on the last number', (w2.server as { code?: string }).code === '3', w2.server)
}

console.log('\n-- 8: the layout reads and compares whole stores --')
{
  const a = putPreset(L('1'), 'A', '5')
  check('equal stores are the same', LAYOUT_ECHO.same(a, putPreset(L('1'), 'A', '5')))
  check('a different preset is not', !LAYOUT_ECHO.same(a, putPreset(L('1'), 'A', '6')))
  check('a different device pointer is not', !LAYOUT_ECHO.same(a, setMobilePreset(a, 'A')))
  check('it reads what it writes', LAYOUT_ECHO.same(LAYOUT_ECHO.parse(LAYOUT_ECHO.content(a))!, a))
  check('nothing stored reads as the same object every time (a stable snapshot)',
    LAYOUT_ECHO.empty === LAYOUT_ECHO.empty && Object.isFrozen(LAYOUT_ECHO.empty))
  check('under its own event type', LAYOUT_ECHO.type === LAYOUT_EVENT && LAYOUT_EVENT === 'net.41chan.tc.layout')
}

console.error = realError
console.warn = realWarn

console.log('\n-- 9: the wiring: every writer goes through accountDataEcho, nothing writes beside it --')
{
  // Comments say what the code does; only the code may satisfy a check.
  const code = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '')
  const wiring = code('client/accountDataEcho.ts')
  check('accountDataEcho is the one setAccountData, built on makeEchoSync',
    (wiring.match(/setAccountData\(/g) ?? []).length === 1 && /makeEchoSync<T>\(/.test(wiring))
  check('and it hands every echo of its type to the sync',
    /if \(ev\.getType\(\) === spec\.type\) sync\.onStored\(\)/.test(wiring))
  for (const [file, spec] of [['ui/tickerCollapse.ts', 'TICKER_ECHO'], ['ui/spaceState.ts', 'LAYOUT_ECHO'], ['client/interfaceStore.ts', 'INTERFACE_ECHO']] as const) {
    const src = code(file)
    check(`${file} writes only through accountDataEcho(client, ${spec})`,
      new RegExp(`accountDataEcho\\(client, ${spec}\\)`).test(src) && !/setAccountData\(/.test(src), file)
    check(`${file} swallows nothing and warns nothing by hand`,
      !/\.catch\(/.test(src) && !/console\.(warn|error)/.test(src), file)
  }
  const space = code('ui/spaceState.ts')
  check('the layout takes a stored number only when it is news',
    /if \(!always && s\.code === known\.current\) return/.test(space))
  check('and marks a save as known BEFORE asking for it, so its own notify is not news',
    /known\.current = code\s*\n\s*echo\.sync\.update\(\(cur\) => \(\{ \.\.\.cur, code \}\)\)/.test(space) &&
    /known\.current = code\s*\n\s*echo\.sync\.update\(\(\) => \(\{ \.\.\.next, code \}\)\)/.test(space))
  check('the drag still saves once the changes stop',
    /saveTimer\.current = setTimeout\(\(\) => \{[\s\S]*?\}, 400\)/.test(space))
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
