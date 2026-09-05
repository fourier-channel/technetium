import { useEffect, useState } from 'react'
import { ClientEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk'

// The ticker's collapse state, held in ACCOUNT DATA so it follows the user
// across devices and sessions (the operator's persistence law: state lives
// where the server can hand it back, never in one browser's storage).
const TYPE = 'net.41chan.tc.ticker'

declare module 'matrix-js-sdk' {
  interface AccountDataEvents {
    'net.41chan.tc.ticker': { collapsed: boolean }
  }
}

export function readTickerCollapsed(client: MatrixClient | null): boolean {
  const content = client?.getAccountData(TYPE)?.getContent()
  return !!content?.collapsed
}

export function useTickerCollapsed(client: MatrixClient | null): [boolean, (v: boolean) => void] {
  const [collapsed, setCollapsedState] = useState(() => readTickerCollapsed(client))

  useEffect(() => {
    if (!client) return
    const onAccountData = (ev: MatrixEvent) => {
      if (ev.getType() === TYPE) setCollapsedState(readTickerCollapsed(client))
    }
    client.on(ClientEvent.AccountData, onAccountData)
    // Re-seed once mounted: the initial useState ran before the client (or its
    // first sync) existed. Deferred, per the no-sync-setState-in-effect rule.
    queueMicrotask(() => setCollapsedState(readTickerCollapsed(client)))
    return () => {
      client.removeListener(ClientEvent.AccountData, onAccountData)
    }
  }, [client])

  const setCollapsed = (v: boolean) => {
    setCollapsedState(v)
    // Optimistic; the account-data echo re-confirms. A failed write leaves
    // the next session where the last successful one was, which is the honest
    // fallback.
    void client?.setAccountData(TYPE, { collapsed: v }).catch(() => {})
  }
  return [collapsed, setCollapsed]
}
