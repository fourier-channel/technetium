import { NO_PINS, parsePins, togglePin } from '../ui/threadPins'
import { reportAlways, reportIgnored } from './report'

// ---------------------------------------------------------------------------
// Keeping a list the user sees in step with the one the server holds -- the
// pinned threads of a room (launch-polish L4). No SDK here: the caller hands
// in how to read the stored content and how to write it, so the check suite
// drives this with a fake server that behaves like the real SDK, including
// its worst habit.
//
// OPTIMISTIC: a click shows at once, so the card moves under the pointer that
// asked for it. The optimistic list is kept until the server has said the same
// thing.
//
// ONE WRITE AT A TIME, AND NEVER AHEAD OF ITS ECHO. The first version sent a
// write per click and lost clicks two ways, both found by review before it
// shipped:
//  - matrix-js-sdk's setAccountData returns WITHOUT sending when the content
//    asked for equals what its local store holds, and that store changes only
//    when the echo arrives. So "unpin, pin" fast sent the unpin, then asked
//    for a list the stale store still held -- nothing was sent, the unpin
//    landed, and the thread ended unpinned against the last click.
//  - two PUTs in flight can land in either order.
// So a write is sent only when the previous one has been echoed back (the
// store is then current, and the SDK's shortcut is honest), a click meanwhile
// only changes what the NEXT write carries, and the latest wish is always the
// one that goes. An echo that never comes is waited on for ECHO_WAIT_MS and no
// longer: a wait needs a deadline.
// ---------------------------------------------------------------------------

export const ECHO_WAIT_MS = 4000

export interface PinPort {
  /** The stored content as the local store holds it now. */
  read: () => unknown
  /** Write the list; resolves when the server has accepted it. */
  write: (pins: string[]) => Promise<unknown>
  /** For the echo deadline; setTimeout unless a test drives the clock. */
  later?: (fn: () => void, ms: number) => void
  /** What the list is, for the failure report. */
  subject?: string
}

export interface PinSync {
  snapshot: () => readonly string[]
  toggle: (id: string) => void
  /** The stored content changed (an echo, or another device). */
  onStored: () => void
  subscribe: (cb: () => void) => () => void
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i])

export function makePinSync(port: PinPort): PinSync {
  const later = port.later ?? ((fn: () => void, ms: number) => void setTimeout(fn, ms))
  const subject = port.subject ?? 'thread pins'
  const listeners = new Set<() => void>()
  // A snapshot must be the SAME array until something changes, or
  // useSyncExternalStore re-renders forever: parse once per content object.
  let lastContent: unknown = undefined
  let lastParsed: readonly string[] = NO_PINS
  // What the user wants, while the server has not yet said it back.
  let pending: readonly string[] | null = null
  // A write on its way, and a written list whose echo has not yet arrived.
  let inflight = false
  let unechoed: readonly string[] | null = null

  const stored = (): readonly string[] => {
    const content = port.read()
    if (content !== lastContent) {
      lastContent = content
      const parsed = parsePins(content)
      if (parsed === null) {
        reportIgnored(
          `${subject}: read`,
          new Error('the saved list is not a list of ids, so it was ignored; pinning or unpinning anything rewrites it'),
        )
        lastParsed = NO_PINS
      } else {
        lastParsed = parsed
      }
    }
    return lastParsed
  }

  const notify = () => {
    for (const cb of listeners) cb()
  }

  // The server has said what the user wants, and nothing of ours is still on
  // its way to say otherwise.
  const settle = () => {
    if (pending && !inflight && !unechoed && same(stored(), pending)) pending = null
  }

  const pump = () => {
    if (inflight || unechoed || !pending) return
    if (same(stored(), pending)) {
      pending = null
      notify()
      return
    }
    const next = pending
    inflight = true
    port.write([...next]).then(
      () => {
        inflight = false
        // Echoed already, or the store held it (the SDK sent nothing because
        // the server has it): either way nothing is outstanding.
        if (same(stored(), next)) {
          unechoed = null
        } else {
          unechoed = next
          later(() => {
            if (unechoed !== next) return
            unechoed = null
            settle()
            notify()
            pump()
          }, ECHO_WAIT_MS)
        }
        settle()
        notify()
        pump()
      },
      (err: unknown) => {
        inflight = false
        unechoed = null
        // Undo only if nothing newer was asked for; a newer wish is sent next.
        if (pending === next) pending = null
        notify()
        reportAlways(`${subject}: save (the change was undone; try again once the connection is back, or check you may still pin in this room)`, err)
        pump()
      },
    )
  }

  return {
    snapshot: () => pending ?? stored(),
    toggle(id) {
      pending = togglePin(pending ?? stored(), id)
      notify()
      pump()
    },
    onStored() {
      // Whatever the server holds now is known, so nothing is outstanding.
      unechoed = null
      settle()
      notify()
      pump()
    },
    subscribe(cb) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
  }
}
