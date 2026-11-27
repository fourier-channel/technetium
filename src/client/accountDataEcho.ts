import { ClientEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk'
import { makeEchoSync, type EchoPort, type EchoSync } from './echoSync'

// ---------------------------------------------------------------------------
// One account-data value a control writes, kept in step with the server
// through echoSync (one write in flight, never ahead of its echo, the latest
// wish wins, a failure undone and reported). The interface options, the
// ticker's collapse, and the layout with its presets all write through here
// (tc.110), so the SDK's equal-write skip (echoSync.ts) is dealt with once
// for them. (The thread-pin folds keep client/pinSync.ts, the list face of
// the same echoSync.)
//
// The spec -- the event type, how the content reads and is written, what the
// failures mean -- is a plain object beside each owner (ui/tickerEcho.ts,
// ui/layoutEcho.ts, client/interfaceStore.ts). The ticker's and the layout's
// are pure modules, so the check suite drives them through echoSync against a
// fake server that skips equal writes as the SDK does
// (checks/accountDataEcho.check.ts). This module is only the wiring to a live
// client: one sync per client and type, listening while anyone listens.
// ---------------------------------------------------------------------------

export interface AccountDataSpec<T> extends Omit<EchoPort<T>, 'read' | 'write' | 'later'> {
  /** The account-data event type. */
  type: string
  /** The content written for a value. */
  content: (value: T) => Record<string, unknown>
}

export interface AccountDataEcho<T> {
  sync: EchoSync<T>
  subscribe: (cb: () => void) => () => void
}

const echoes = new WeakMap<MatrixClient, Map<string, AccountDataEcho<unknown>>>()

export function accountDataEcho<T>(client: MatrixClient, spec: AccountDataSpec<T>): AccountDataEcho<T> {
  let byType = echoes.get(client)
  if (!byType) echoes.set(client, (byType = new Map()))
  const found = byType.get(spec.type)
  if (found) return found as AccountDataEcho<T>
  // The type is a string here; each owner declares its content shape on
  // AccountDataEvents beside its hook.
  const type = spec.type as never
  const sync = makeEchoSync<T>({
    ...spec,
    read: () => client.getAccountData(type)?.getContent(),
    write: (value) => client.setAccountData(type, spec.content(value) as never),
  })
  const onAccountData = (ev: MatrixEvent) => {
    if (ev.getType() === spec.type) sync.onStored()
  }
  let users = 0
  const echo: AccountDataEcho<T> = {
    sync,
    subscribe(cb) {
      const off = sync.subscribe(cb)
      // What arrived while nobody listened needs no replay: a snapshot reads
      // the local store afresh whenever its content object has changed.
      if (users++ === 0) client.on(ClientEvent.AccountData, onAccountData)
      return () => {
        off()
        if (--users === 0) client.removeListener(ClientEvent.AccountData, onAccountData)
      }
    },
  }
  byType.set(spec.type, echo as AccountDataEcho<unknown>)
  return echo
}
