import { useSyncExternalStore } from 'react'
import { ClientEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk'
import { NO_PINS } from '../ui/threadPins'
import { makePinSync } from './pinSync'

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
// How the list on screen stays in step with the server's -- optimistic, one
// write at a time, never ahead of its echo -- is client/pinSync.ts, which has
// no SDK in it so the check suite can drive it against a fake server.
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

function makeStore(client: MatrixClient): PinStore {
  const sync = makePinSync({
    read: () => client.getAccountData(TYPE)?.getContent(),
    write: (pins) => client.setAccountData(TYPE, { pins }),
  })
  const onAccountData = (ev: MatrixEvent) => {
    if (ev.getType() === TYPE) sync.onStored()
  }
  let users = 0
  return {
    subscribe(cb) {
      const off = sync.subscribe(cb)
      if (users++ === 0) client.on(ClientEvent.AccountData, onAccountData)
      return () => {
        off()
        if (--users === 0) client.removeListener(ClientEvent.AccountData, onAccountData)
      }
    },
    snapshot: sync.snapshot,
    toggle: sync.toggle,
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
