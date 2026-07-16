import { useCallback, useEffect, useState } from 'react'
import { RoomStateEvent, type MatrixClient, type Room } from 'matrix-js-sdk'
import {
  decodeTransform,
  encodeTransform,
  type Transform,
} from '../ui/uitransform/transform'

// ---------------------------------------------------------------------------
// The domain background is SHARED room state (`net.41chan.domain.background`,
// single state key): an admin (PL >= state_default, typically 50) sets an image
// + its transform once and everyone in the domain sees it. Non-admin writes
// 403 -- caught and ignored, the UI just won't persist. Distinct from the
// legacy LOCAL per-room backdrop URL; the shared background takes precedence.
//
// The image is a Matrix mxc uri (uploaded via client.uploadContent); the
// transform rides along in canonical-JSON-safe integer form (uitransform wire).
// ---------------------------------------------------------------------------

export const DOMAIN_BACKGROUND_EVENT = 'net.41chan.domain.background'

export interface DomainBackground {
  mxc: string
  transform: Transform
}

export interface DomainBackgroundApi {
  background: DomainBackground | null
  setBackground: (mxc: string, transform: Transform) => Promise<void>
  clearBackground: () => Promise<void>
}

function read(room: Room | null): DomainBackground | null {
  if (!room) return null
  const ev = room.currentState.getStateEvents(DOMAIN_BACKGROUND_EVENT, '')
  if (!ev) return null
  const c = ev.getContent()
  if (typeof c.url !== 'string' || !c.url) return null
  return { mxc: c.url, transform: decodeTransform(c) }
}

export function useDomainBackground(
  client: MatrixClient | null,
  room: Room | null,
): DomainBackgroundApi {
  const [background, setBackgroundState] = useState<DomainBackground | null>(() => read(room))

  useEffect(() => {
    if (!client || !room) return
    const refresh = () => setBackgroundState(read(room))
    const t = setTimeout(refresh, 0) // re-read on room change (async, not in body)
    const onState = (_ev: unknown, state: { roomId?: string } | undefined) => {
      if (state?.roomId === room.roomId) refresh()
    }
    client.on(RoomStateEvent.Events, onState)
    return () => {
      clearTimeout(t)
      client.off(RoomStateEvent.Events, onState)
    }
  }, [client, room])

  // sendStateEvent is typed to known event names and uses `this` internally, so
  // reach the custom type through a bound, loosely-typed alias (cf. G-bf03).
  const writeState = useCallback(
    (content: Record<string, unknown>) => {
      if (!client || !room) return Promise.resolve()
      const send = client.sendStateEvent.bind(client) as unknown as (
        roomId: string,
        eventType: string,
        content: Record<string, unknown>,
        stateKey: string,
      ) => Promise<unknown>
      return send(room.roomId, DOMAIN_BACKGROUND_EVENT, content, '').then(() => undefined)
    },
    [client, room],
  )

  const setBackground = useCallback(
    (mxc: string, transform: Transform) =>
      writeState({ url: mxc, ...encodeTransform(transform) }).catch(() => {
        // 403 for non-admins / offline; local UI already reflects the choice.
      }),
    [writeState],
  )

  const clearBackground = useCallback(
    () =>
      writeState({}).catch(() => {
        // best-effort; empty content clears the background state.
      }),
    [writeState],
  )

  return { background, setBackground, clearBackground }
}
