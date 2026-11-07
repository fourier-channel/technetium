import { NO_PINS, parsePins, togglePin } from '../ui/threadPins'
import { makeEchoSync } from './echoSync'

// ---------------------------------------------------------------------------
// Keeping a list the user sees in step with the one the server holds -- the
// pinned threads of a room (launch-polish L4). The rule it keeps (optimistic,
// one write at a time, never ahead of its echo, an echo waited on with a
// deadline) and the reasons for it are in echoSync.ts, which this is the
// string-list face of: generalised there for the interface options
// (INTERFACE_OPTIONS IO7), so there is one implementation of it.
// ---------------------------------------------------------------------------

export { ECHO_WAIT_MS } from './echoSync'

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
  /** Replace the list with what `fn` makes of the current one. */
  update: (fn: (current: readonly string[]) => readonly string[]) => void
  /** The stored content changed (an echo, or another device). */
  onStored: () => void
  subscribe: (cb: () => void) => () => void
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i])

export function makePinSync(port: PinPort): PinSync {
  const sync = makeEchoSync<readonly string[]>({
    read: port.read,
    parse: parsePins,
    empty: NO_PINS,
    same,
    write: (pins) => port.write([...pins]),
    later: port.later,
    subject: port.subject ?? 'thread pins',
    unreadable: 'the saved list is not a list of ids, so it was ignored; pinning or unpinning anything rewrites it',
    failed: 'the change was undone; try again once the connection is back, or check you may still pin in this room',
  })
  return {
    ...sync,
    toggle: (id) => sync.update((current) => togglePin(current, id)),
  }
}
