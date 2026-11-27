import { useSyncExternalStore } from 'react'
import type { MatrixClient } from 'matrix-js-sdk'
import { accountDataEcho } from '../client/accountDataEcho'
import { TICKER_ECHO } from './tickerEcho'

// The ticker's collapse state: account data, written through echoSync
// (tc.110). What it stores, how it reads, and what a failure means are in
// tickerEcho.ts, which is pure and checked.

declare module 'matrix-js-sdk' {
  interface AccountDataEvents {
    'net.41chan.tc.ticker': { collapsed: boolean }
  }
}

const noSubscribe = () => () => {}
const open = () => TICKER_ECHO.empty
const noop = () => {}

export function useTickerCollapsed(client: MatrixClient | null): [boolean, (v: boolean) => void] {
  const echo = client ? accountDataEcho(client, TICKER_ECHO) : null
  const collapsed = useSyncExternalStore(
    echo ? echo.subscribe : noSubscribe,
    echo ? echo.sync.snapshot : open,
    echo ? echo.sync.snapshot : open,
  )
  const setCollapsed = echo ? (v: boolean) => echo.sync.update(() => v) : noop
  return [collapsed, setCollapsed]
}
