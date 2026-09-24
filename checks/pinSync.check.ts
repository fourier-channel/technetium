// Checks for keeping the pinned-thread list in step with the server
// (launch-polish L4, client/pinSync.ts).
//
// The fake server below behaves like matrix-js-sdk 41.6's setAccountData in
// the one way that matters: when the content asked for deep-equals what the
// LOCAL store holds, it resolves at once and sends nothing -- and the local
// store changes only when the echo arrives. Review found that this, plus a
// write per click, made "unpin, pin" fast end unpinned against the last
// click. Every scenario here asserts the SERVER ends where the last click
// said, and that the screen never shows the opposite on the way.
import { makePinSync, ECHO_WAIT_MS, type PinSync } from '../src/client/pinSync.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

// A server, a local store that only learns by echo, and hands on every step.
function world(initial: string[]) {
  let server = [...initial]
  let store: { pins: string[] } = { pins: [...initial] }
  let puts = 0
  const queue: { pins: string[]; resolve: () => void; reject: (e: unknown) => void }[] = []
  const timers: { fn: () => void; at: number }[] = []
  let now = 0
  let sync!: PinSync
  const w = {
    get server() { return server },
    get puts() { return puts },
    queued: () => queue.length,
    port: {
      read: () => store,
      write: (pins: string[]) => {
        if (JSON.stringify(store.pins) === JSON.stringify(pins)) return Promise.resolve({})
        puts++
        return new Promise<unknown>((resolve, reject) => queue.push({ pins, resolve: () => resolve({}), reject }))
      },
      later: (fn: () => void, ms: number) => { timers.push({ fn, at: now + ms }) },
    },
    // The oldest PUT reaches the server (lands), and its promise resolves.
    land: async (i = 0) => {
      const q = queue.splice(i, 1)[0]
      server = q.pins
      q.resolve()
      await tick()
    },
    // The same two halves, separately, so the echo can come in between.
    apply: () => { server = queue[0].pins },
    resolve: async () => { queue.shift()!.resolve(); await tick() },
    fail: async () => {
      const q = queue.shift()!
      q.reject(new Error('network'))
      await tick()
    },
    // The server's current list reaches the local store, and sync hears it.
    echo: async () => {
      store = { pins: [...server] }
      sync.onStored()
      await tick()
    },
    // Another device writes.
    elsewhere: async (pins: string[]) => {
      server = [...pins]
      await w.echo()
    },
    advance: async (ms: number) => {
      now += ms
      for (const t of timers.splice(0)) if (t.at <= now) t.fn(); else timers.push(t)
      await tick()
    },
    attach: (s: PinSync) => { sync = s },
  }
  return w
}

const seen: string[][] = []
function start(w: ReturnType<typeof world>) {
  const s = makePinSync(w.port)
  w.attach(s)
  seen.length = 0
  s.subscribe(() => seen.push([...s.snapshot()]))
  return s
}
const eq = (a: readonly string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b)

console.log('\n-- A: pinned, then unpin and pin again before the echo --')
{
  const w = world(['A'])
  const s = start(w)
  s.toggle('A') // unpin
  s.toggle('A') // and pin again, fast
  check('the screen says pinned at once', eq(s.snapshot(), ['A']), s.snapshot())
  await w.land(); await w.echo()
  // The unpin landed; the pin must follow it rather than be skipped.
  check('the screen never shows the unpin landing', seen.every((v) => eq(v, ['A']) || eq(v, [])) && eq(s.snapshot(), ['A']), s.snapshot())
  while (w.queued()) { await w.land(); await w.echo() }
  check('the server ends pinned, as the last click said', eq(w.server, ['A']), w.server)
  check('and the screen agrees', eq(s.snapshot(), ['A']), s.snapshot())
}

console.log('\n-- B: unpinned, then pin and unpin again before the echo --')
{
  const w = world([])
  const s = start(w)
  s.toggle('A'); s.toggle('A')
  await w.land(); await w.echo()
  while (w.queued()) { await w.land(); await w.echo() }
  check('the server ends unpinned', eq(w.server, []), w.server)
  check('and the screen agrees', eq(s.snapshot(), []), s.snapshot())
}

console.log('\n-- C: two different pins in quick succession --')
{
  const w = world([])
  const s = start(w)
  s.toggle('A'); s.toggle('B')
  check('only ONE write is in flight at a time', w.queued() === 1, w.queued())
  await w.land(); await w.echo()
  while (w.queued()) { await w.land(); await w.echo() }
  check('both pins reach the server, in order', eq(w.server, ['A', 'B']), w.server)
  check('the screen held A,B throughout once B was clicked', eq(s.snapshot(), ['A', 'B']))
}

console.log('\n-- the echo arriving BEFORE the write resolves --')
{
  const w = world([])
  const s = start(w)
  s.toggle('A')
  // The server applies it and the echo comes first; the promise resolves after.
  w.apply()
  await w.echo()
  await w.resolve()
  check('settles on the pin', eq(s.snapshot(), ['A']) && eq(w.server, ['A']))
  check('and sends nothing more', w.queued() === 0 && w.puts === 1, w.puts)
  s.toggle('B')
  check('and the next click is not held behind an echo that already came', w.queued() === 1, w.queued())
}

console.log('\n-- an echo that never comes is waited on, not forever --')
{
  const w = world([])
  const s = start(w)
  s.toggle('A')
  await w.land() // accepted, but no echo
  s.toggle('B') // wants A,B; blocked behind the missing echo
  check('the second write waits for the first one\'s echo', w.queued() === 0, w.queued())
  await w.advance(ECHO_WAIT_MS)
  check('after the deadline it goes anyway', w.queued() === 1, w.queued())
  await w.land(); await w.echo()
  check('and the server ends with both', eq(w.server, ['A', 'B']), w.server)
}

console.log('\n-- a failed write undoes that click, and says so --')
{
  const w = world([])
  const s = start(w)
  const warned: string[] = []
  const orig = console.warn
  console.warn = (m: string) => warned.push(m)
  s.toggle('A')
  await w.fail()
  console.warn = orig
  check('the pin is undone on screen', eq(s.snapshot(), []), s.snapshot())
  check('the failure is reported with its remedy', warned.some((m) => /thread pins: save.*try again/.test(m)), warned)
}

console.log('\n-- another device changes the pins --')
{
  const w = world(['A'])
  const s = start(w)
  await w.elsewhere(['A', 'C'])
  check('the screen follows the server', eq(s.snapshot(), ['A', 'C']), s.snapshot())
  check('and nothing is written back', w.puts === 0, w.puts)
}

console.log('\n-- update: a whole-list change goes through the same one-at-a-time path --')
{
  const w = world(['A'])
  const s = start(w)
  s.update((cur) => [...cur, 'B', 'C'])
  s.update((cur) => cur.filter((x) => x !== 'A'))
  check('only one write in flight', w.queued() === 1, w.queued())
  await w.land(); await w.echo()
  while (w.queued()) { await w.land(); await w.echo() }
  check('the server ends with the last wish', eq(w.server, ['B', 'C']), w.server)
}

console.log('\n-- the snapshot is stable while nothing changes --')
{
  const w = world(['A'])
  const s = makePinSync(w.port)
  check('same array twice', s.snapshot() === s.snapshot())
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
