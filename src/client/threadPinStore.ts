import { useSyncExternalStore } from 'react'
import { ClientEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk'
import { NO_PINS, parsePins, togglePin } from '../ui/threadPins'
import { reportAlways, reportIgnored } from './report'

// ---------------------------------------------------------------------------
// Pinned threads, held in ACCOUNT DATA (launch-polish L4).
//
// The operator's persistence law: state the user sets lives where the server
// can hand it back, so a pin follows the account to every device and session,
// and a shared browser does not leak one account's pins into another's. The
// ordering rule is ui/threadPins.ts; this is only where the list lives.
//
// A store for useSyncExternalStore rather than useState + a listener, so every
// surface reading pins agrees within the same render.
//
// OPTIMISTIC, WITH AN HONEST ECHO. A pin shows the moment it is clicked, not a
// round trip later, so the card moves under the pointer that asked for it. The
// optimistic list is held until the server's copy says the same thing -- an
// echo of an EARLIER write, arriving after a second quick toggle, must not
// flip the card back (the layout store paid for that lesson). Once our write
// has settled, whatever the server says next is the truth, including a change
// made on another device.
// ---------------------------------------------------------------------------

const TYPE = 'net.41chan.tc.thread_pins'

declare module 'matrix-js-sdk' {
  interface AccountDataEvents {
    'net.41chan.tc.thread_pins': { pins: string[] }
  }
}

interface PinStore {
  subscribe: (cb: () => void) => () => void
  snapshot: () => readonly string[]
  toggle: (id: string) => void
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i])

function makeStore(client: MatrixClient): PinStore {
  const listeners = new Set<() => void>()
  // The content object last parsed, and what it parsed to: a snapshot must be
  // the SAME array until something changes, or useSyncExternalStore re-renders
  // forever.
  let lastContent: unknown = undefined
  let lastParsed: readonly string[] = NO_PINS
  // The optimistic list, and whether the write that carries it has settled.
  let pending: readonly string[] | null = null
  let settled = false

  const stored = (): readonly string[] => {
    const content = client.getAccountData(TYPE)?.getContent()
    if (content !== lastContent) {
      lastContent = content
      const parsed = parsePins(content)
      if (parsed === null) {
        reportIgnored(
          'thread pins: read',
          new Error('the saved pin list is not a list of thread ids, so it was ignored; pinning or unpinning any thread rewrites it'),
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

  const onAccountData = (ev: MatrixEvent) => {
    if (ev.getType() !== TYPE) return
    if (pending && (settled || same(stored(), pending))) pending = null
    notify()
  }

  let attached = false
  return {
    subscribe(cb) {
      listeners.add(cb)
      if (!attached) {
        client.on(ClientEvent.AccountData, onAccountData)
        attached = true
      }
      return () => {
        listeners.delete(cb)
        if (listeners.size === 0 && attached) {
          client.removeListener(ClientEvent.AccountData, onAccountData)
          attached = false
        }
      }
    },
    snapshot() {
      return pending ?? stored()
    },
    toggle(id) {
      const next = togglePin(pending ?? stored(), id)
      pending = next
      settled = false
      notify()
      client.setAccountData(TYPE, { pins: next }).then(
        () => {
          if (pending !== next) return
          settled = true
          // The echo may already have landed before the write resolved.
          if (same(stored(), next)) {
            pending = null
            notify()
          }
        },
        (err: unknown) => {
          // Undo only if nothing newer was asked for in the meantime.
          if (pending === next) {
            pending = null
            notify()
          }
          reportAlways('thread pins: save (the pin was undone; try again once the connection is back)', err)
        },
      )
    },
  }
}

const stores = new WeakMap<MatrixClient, PinStore>()

function storeFor(client: MatrixClient): PinStore {
  let s = stores.get(client)
  if (!s) {
    s = makeStore(client)
    stores.set(client, s)
  }
  return s
}

const NO_CLIENT: PinStore = {
  subscribe: () => () => {},
  snapshot: () => NO_PINS,
  toggle: () => {},
}

/** The pinned thread ids (flip ids, `roomId|rootId`), in pin order. */
export function useThreadPins(client: MatrixClient | null): {
  pins: readonly string[]
  toggle: (id: string) => void
} {
  const store = client ? storeFor(client) : NO_CLIENT
  const pins = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot)
  return { pins, toggle: store.toggle }
}
