import { useSyncExternalStore } from 'react'
import type { MatrixClient } from 'matrix-js-sdk'
import { accountDataEcho, type AccountDataSpec } from './accountDataEcho'
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
// through echoSync by way of accountDataEcho.ts (one write in flight, never
// ahead of its echo -- a slider dragged across its range is a handful of
// writes, and the last position is the one kept). The rules about what the content may say are in
// interfacePrefs.ts, which is pure and checked.
// ---------------------------------------------------------------------------

declare module 'matrix-js-sdk' {
  interface AccountDataEvents {
    'net.41chan.tc.interface': Record<string, unknown>
  }
}

const INTERFACE_ECHO: AccountDataSpec<InterfacePrefs> = {
  type: INTERFACE_EVENT,
  parse: parseInterfacePrefs,
  empty: DEFAULT_PREFS,
  same: samePrefs,
  content: serializeInterfacePrefs,
  subject: 'interface options',
  unreadable: 'the saved interface options are not readable, so the defaults are shown; changing any option rewrites them',
  failed: 'the change was undone; try again once the connection is back',
}

const noSubscribe = () => () => {}
const none = () => DEFAULT_PREFS
const noop = () => {}

export function useInterfacePrefs(client: MatrixClient | null): {
  prefs: InterfacePrefs
  update: (fn: (current: InterfacePrefs) => InterfacePrefs) => void
} {
  const store = client ? accountDataEcho(client, INTERFACE_ECHO) : null
  const prefs = useSyncExternalStore(
    store ? store.subscribe : noSubscribe,
    store ? store.sync.snapshot : none,
    store ? store.sync.snapshot : none,
  )
  return { prefs, update: store ? store.sync.update : noop }
}
