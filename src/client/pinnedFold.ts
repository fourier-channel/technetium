import { useSyncExternalStore } from 'react'
import { ClientEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk'
import { NO_PINS, foldIds, unfoldIds } from '../ui/threadPins'
import { makePinSync, type PinSync } from './pinSync'

// ---------------------------------------------------------------------------
// Which pinned threads THIS PERSON has folded away behind the pushpin
// (launch-polish L4). Pins are the room's; folding them is the reader's, so
// it lives in account data and follows them to every device -- the operator's
// persistence law. Kept per thread, so a thread pinned later starts open
// again, as pinned threads do.
//
// Written through pinSync: one write in flight, never ahead of its echo,
// because the SDK skips an account-data write that equals its stale store
// (memory sdk-setaccountdata-skips-equal-writes). The content's list is
// called `pins` so pinSync's reader parses it; here it means "pinned threads
// folded away", as flip ids.
// ---------------------------------------------------------------------------

const TYPE = 'net.41chan.tc.pinned_folded'

declare module 'matrix-js-sdk' {
  interface AccountDataEvents {
    'net.41chan.tc.pinned_folded': { pins: string[] }
  }
}

interface FoldStore {
  sync: PinSync
  subscribe: (cb: () => void) => () => void
}

const stores = new WeakMap<MatrixClient, FoldStore>()

function storeFor(client: MatrixClient): FoldStore {
  const found = stores.get(client)
  if (found) return found
  const sync = makePinSync({
    read: () => client.getAccountData(TYPE)?.getContent(),
    write: (pins) => client.setAccountData(TYPE, { pins }),
    subject: 'folded pinned threads',
  })
  const onAccountData = (ev: MatrixEvent) => {
    if (ev.getType() === TYPE) sync.onStored()
  }
  let users = 0
  const store: FoldStore = {
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
const none = () => NO_PINS
const noop = () => {}

export function usePinnedFold(client: MatrixClient | null): {
  folded: readonly string[]
  fold: (ids: readonly string[]) => void
  unfold: (ids: readonly string[]) => void
} {
  const store = client ? storeFor(client) : null
  const folded = useSyncExternalStore(
    store ? store.subscribe : noSubscribe,
    store ? store.sync.snapshot : none,
    store ? store.sync.snapshot : none,
  )
  if (!store) return { folded, fold: noop, unfold: noop }
  return {
    folded,
    fold: (ids) => store.sync.update((cur) => foldIds(cur, ids)),
    unfold: (ids) => store.sync.update((cur) => unfoldIds(cur, ids)),
  }
}
