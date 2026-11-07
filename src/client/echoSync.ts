import { reportAlways, reportIgnored } from './report'

// ---------------------------------------------------------------------------
// Keeping a value the user sees in step with the one the server holds, for
// anything written from a control into account data or room state. No SDK
// here: the caller hands in how to read the stored content and how to write
// it, so the check suite drives this with a fake server that behaves like the
// real SDK, including its worst habit. Born as the thread pins' sync
// (launch-polish L4) and generalised when the interface options needed the
// same thing for an object (INTERFACE_OPTIONS IO7), so there is one of it.
//
// OPTIMISTIC: a change shows at once, so the control moves under the pointer
// that asked for it. The optimistic value is kept until the server has said
// the same thing.
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
// store is then current, and the SDK's shortcut is honest), a change meanwhile
// only changes what the NEXT write carries, and the latest wish is always the
// one that goes. A slider dragged for a second is therefore a handful of
// writes, not sixty. An echo that never comes is waited on for ECHO_WAIT_MS
// and no longer: a wait needs a deadline.
// ---------------------------------------------------------------------------

export const ECHO_WAIT_MS = 4000

export interface EchoPort<T> {
  /** The stored content as the local store holds it now. */
  read: () => unknown
  /** The value in that content; null when the content is not one (reported). */
  parse: (content: unknown) => T | null
  /** What an absent or unreadable content means. */
  empty: T
  /** Whether two values say the same thing. */
  same: (a: T, b: T) => boolean
  /** Write the value; resolves when the server has accepted it. */
  write: (value: T) => Promise<unknown>
  /** For the echo deadline; setTimeout unless a test drives the clock. */
  later?: (fn: () => void, ms: number) => void
  /** What the value is, for the failure reports. */
  subject: string
  /** What an unreadable stored value means for the user, and its remedy. */
  unreadable?: string
  /** What a failed write means for the user, and its remedy. */
  failed?: string
}

export interface EchoSync<T> {
  snapshot: () => T
  /** Replace the value with what `fn` makes of the current one. */
  update: (fn: (current: T) => T) => void
  /** The stored content changed (an echo, or another device). */
  onStored: () => void
  subscribe: (cb: () => void) => () => void
}

export function makeEchoSync<T>(port: EchoPort<T>): EchoSync<T> {
  const later = port.later ?? ((fn: () => void, ms: number) => void setTimeout(fn, ms))
  const subject = port.subject
  const same = port.same
  const listeners = new Set<() => void>()
  // A snapshot must be the SAME value until something changes, or
  // useSyncExternalStore re-renders forever: parse once per content object.
  let lastContent: unknown = undefined
  let lastParsed: T = port.empty
  // What the user wants, while the server has not yet said it back.
  let pending: T | null = null
  // A write on its way, and a written value whose echo has not yet arrived.
  let inflight = false
  let unechoed: T | null = null

  const stored = (): T => {
    const content = port.read()
    if (content !== lastContent) {
      lastContent = content
      const parsed = content === undefined || content === null ? port.empty : port.parse(content)
      if (parsed === null) {
        reportIgnored(
          `${subject}: read`,
          new Error(port.unreadable ?? 'the saved value is not readable, so it was ignored; changing it rewrites it'),
        )
        lastParsed = port.empty
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
    if (pending !== null && !inflight && unechoed === null && same(stored(), pending)) pending = null
  }

  const pump = () => {
    if (inflight || unechoed !== null || pending === null) return
    if (same(stored(), pending)) {
      pending = null
      notify()
      return
    }
    const next = pending
    inflight = true
    port.write(next).then(
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
        reportAlways(`${subject}: save (${port.failed ?? 'the change was undone; try again once the connection is back'})`, err)
        pump()
      },
    )
  }

  return {
    snapshot: () => pending ?? stored(),
    update(fn) {
      pending = fn(pending ?? stored())
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
