import { useEffect, useRef, useState } from 'react'
import { ClientEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk'
import { defaultSpace, deserialize, serialize, type Space } from './space'

// The space, held in ACCOUNT DATA as its number, so it follows the user
// across devices and sessions and can be pasted into another client. Same
// pattern as the ticker's collapse state.
const TYPE = 'net.41chan.tc.layout'

declare module 'matrix-js-sdk' {
  interface AccountDataEvents {
    'net.41chan.tc.layout': { code: string }
  }
}

export function readSpace(client: MatrixClient | null): Space {
  const code = client?.getAccountData(TYPE)?.getContent()?.code
  // A number that does not parse is treated as absent, never as a partial
  // layout: the default is a known-good screen and a corrupt code is not.
  // A v1 number (the earlier one-axis model) is refused by deserialize and
  // reads as the default, which is the honest answer to a superseded shape.
  return (typeof code === 'string' && deserialize(code)) || defaultSpace()
}

export type SpaceUpdate = Space | ((prev: Space) => Space)

export function useStoredSpace(client: MatrixClient | null): [Space, (u: SpaceUpdate) => void] {
  const [layout, setLayoutState] = useState<Space>(() => readSpace(client))
  // The latest layout, for updaters: a drag fires many deltas between renders,
  // and each must apply to the result of the last, not to a stale closure.
  const latest = useRef(layout)
  useEffect(() => {
    latest.current = layout
  }, [layout])

  // What this client last wrote, so its own echo is not mistaken for news.
  // Without this, a drag -- many changes, each saved -- had earlier saves'
  // echoes landing mid-drag and overwriting local state with a stale,
  // quantised value; the next step then applied to that base, and the drag
  // lost ground at random (measured: the same 120 px drag moved 69 px in one
  // run and 20 px in the next).
  const lastWritten = useRef<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!client) return
    const onAccountData = (ev: MatrixEvent) => {
      if (ev.getType() !== TYPE) return
      const code = ev.getContent()?.code
      if (typeof code === 'string' && code === lastWritten.current) return // our own
      setLayoutState(readSpace(client))
    }
    client.on(ClientEvent.AccountData, onAccountData)
    queueMicrotask(() => setLayoutState(readSpace(client)))
    return () => {
      client.removeListener(ClientEvent.AccountData, onAccountData)
    }
  }, [client])

  const setLayout = (u: SpaceUpdate) => {
    const l = typeof u === 'function' ? u(latest.current) : u
    latest.current = l
    setLayoutState(l)
    if (!client) return
    // Saved once the changes stop, not on every step of a drag: a drag is
    // dozens of changes a second and one number at the end. Optimistic; the
    // echo of our own write is ignored above, so it cannot fight the drag.
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      const code = serialize(latest.current)
      lastWritten.current = code
      client.setAccountData(TYPE, { code }).catch((err: unknown) => {
        console.warn('[layout] could not save', err)
      })
    }, 400)
  }
  return [layout, setLayout]
}
