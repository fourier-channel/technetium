import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from 'react'
import { DEFAULT_LOOK, type Look } from '../client/look'
import type { LookStore, LookSupport } from '../client/lookStore'

// The look store, one per signed-in client (App provides it), and the hook
// every avatar and every name draws from (L24).
export const LookStoreContext = createContext<LookStore | null>(null)

const noSubscribe = () => () => {}

// A person's look: the default until it has been read, then theirs. The
// snapshot is the look object itself, which the store keeps identical until
// that person's look changes -- so a member list drawing two hundred people
// redraws one row when one look arrives, not all two hundred. Asking is an
// effect, never a render (G-tc01).
export function useLook(userId: string | null | undefined): Look {
  const store = useContext(LookStoreContext)
  const snapshot = useCallback(
    () => (store && userId ? store.peek(userId) : DEFAULT_LOOK),
    [store, userId],
  )
  const look = useSyncExternalStore(store ? store.subscribe : noSubscribe, snapshot, snapshot)
  useEffect(() => {
    if (store && userId) store.want(userId)
  }, [store, userId])
  return look
}

export function useLookStore(): LookStore | null {
  return useContext(LookStoreContext)
}

export function useLookSupport(): LookSupport {
  const store = useContext(LookStoreContext)
  const snapshot = useCallback((): LookSupport => (store ? store.support() : 'unknown'), [store])
  return useSyncExternalStore(store ? store.subscribe : noSubscribe, snapshot, snapshot)
}
