import { useSyncExternalStore } from 'react'
import { ClientEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk'
import { makeEchoSync, type EchoSync } from './echoSync'
import {
  DEFAULT_PREFS,
  INTERFACE_EVENT,
  parseInterfacePrefs,
  samePrefs,
  serializeInterfacePrefs,
  type InterfacePrefs,
} from './interfacePrefs'

// ---------------------------------------------------------------------------
// The interface options' store (INTERFACE_OPTIONS IO7): account data, written
// through echoSync (one write in flight, never ahead of its echo -- a slider
// dragged across its range is a handful of writes, and the last position is
// the one kept). The rules about what the content may say are in
// interfacePrefs.ts, which is pure and checked.
// ---------------------------------------------------------------------------

declare module 'matrix-js-sdk' {
  interface AccountDataEvents {
    'net.41chan.tc.interface': Record<string, unknown>
  }
}

interface InterfaceStore {
  sync: EchoSync<InterfacePrefs>
  subscribe: (cb: () => void) => () => void
}

const stores = new WeakMap<MatrixClient, InterfaceStore>()

function storeFor(client: MatrixClient): InterfaceStore {
  const found = stores.get(client)
  if (found) return found
  const sync = makeEchoSync<InterfacePrefs>({
    read: () => client.getAccountData(INTERFACE_EVENT)?.getContent(),
    parse: parseInterfacePrefs,
    empty: DEFAULT_PREFS,
    same: samePrefs,
    write: (p) => client.setAccountData(INTERFACE_EVENT, serializeInterfacePrefs(p)),
    subject: 'interface options',
    unreadable: 'the saved interface options are not readable, so the defaults are shown; changing any option rewrites them',
    failed: 'the change was undone; try again once the connection is back',
  })
  const onAccountData = (ev: MatrixEvent) => {
    if (ev.getType() === INTERFACE_EVENT) sync.onStored()
  }
  let users = 0
  const store: InterfaceStore = {
    sync,
    subscribe(cb) {
      const off = sync.subscribe(cb)
      if (users++ === 0) client.on(ClientEvent.AccountData, onAccountData)
      return () => {
        off()
        if (--users === 0) client.removeListener(ClientEvent.AccountData, onAccountData)
      }
    },
  }
  stores.set(client, store)
  return store
}

const noSubscribe = () => () => {}
const none = () => DEFAULT_PREFS
const noop = () => {}

export function useInterfacePrefs(client: MatrixClient | null): {
  prefs: InterfacePrefs
  update: (fn: (current: InterfacePrefs) => InterfacePrefs) => void
} {
  const store = client ? storeFor(client) : null
  const prefs = useSyncExternalStore(
    store ? store.subscribe : noSubscribe,
    store ? store.sync.snapshot : none,
    store ? store.sync.snapshot : none,
  )
  return { prefs, update: store ? store.sync.update : noop }
}
