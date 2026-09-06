import { useEffect, useRef, useState } from 'react'
import { ClientEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk'
import { defaultLayout, deserialize, serialize, type Layout } from './layout'

// The layout, held in ACCOUNT DATA as its number, so it follows the user
// across devices and sessions and can be pasted into another client. Same
// pattern as the ticker's collapse state.
const TYPE = 'net.41chan.tc.layout'

declare module 'matrix-js-sdk' {
  interface AccountDataEvents {
    'net.41chan.tc.layout': { code: string }
  }
}

export function readLayout(client: MatrixClient | null): Layout {
  const code = client?.getAccountData(TYPE)?.getContent()?.code
  // A number that does not parse is treated as absent, never as a partial
  // layout: the default is a known-good screen and a corrupt code is not.
  return (typeof code === 'string' && deserialize(code)) || defaultLayout()
}

export type LayoutUpdate = Layout | ((prev: Layout) => Layout)

export function useStoredLayout(client: MatrixClient | null): [Layout, (u: LayoutUpdate) => void] {
  const [layout, setLayoutState] = useState<Layout>(() => readLayout(client))
  // The latest layout, for updaters: a drag fires many deltas between renders,
  // and each must apply to the result of the last, not to a stale closure.
  const latest = useRef(layout)
  useEffect(() => {
    latest.current = layout
  }, [layout])

  useEffect(() => {
    if (!client) return
    const onAccountData = (ev: MatrixEvent) => {
      if (ev.getType() === TYPE) setLayoutState(readLayout(client))
    }
    client.on(ClientEvent.AccountData, onAccountData)
    queueMicrotask(() => setLayoutState(readLayout(client)))
    return () => {
      client.removeListener(ClientEvent.AccountData, onAccountData)
    }
  }, [client])

  const setLayout = (u: LayoutUpdate) => {
    const l = typeof u === 'function' ? u(latest.current) : u
    latest.current = l
    setLayoutState(l)
    if (!client) return
    // Optimistic; the account-data echo re-confirms.
    client.setAccountData(TYPE, { code: serialize(l) }).catch((err: unknown) => {
      console.warn('[layout] could not save', err)
    })
  }
  return [layout, setLayout]
}
