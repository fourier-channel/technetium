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
// + its transform once and everyone in the domain sees it. Distinct from the
// legacy LOCAL per-room backdrop URL; the shared background takes precedence.
//
// Write failures PROPAGATE. They used to be caught and dropped on the floor
// with a comment claiming "local UI already reflects the choice" -- it does
// not: `background` is read back from room state, so a failed write means the
// background never appears for ANYONE, including the person who set it, with
// nothing on screen to say so. `canSet` lets a caller check first, so a user
// without permission is told before uploading a file rather than after.
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
  // False when the local user's power level cannot write this state event.
  canSet: boolean
  // REJECT on failure -- callers must surface it.
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
  const [canSet, setCanSet] = useState(false)

  useEffect(() => {
    if (!client || !room) return
    const refresh = () => {
      setBackgroundState(read(room))
      const me = client.getUserId()
      setCanSet(!!me && room.currentState.maySendStateEvent(DOMAIN_BACKGROUND_EVENT, me))
    }
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
      // Rejecting rather than resolving: a caller awaiting this must not be
      // told the write succeeded when nothing was sent.
      if (!client || !room) return Promise.reject(new Error('Not connected to the room.'))
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
      writeState({ url: mxc, ...encodeTransform(transform) }),
    [writeState],
  )

  // Empty content clears the background state.
  const clearBackground = useCallback(() => writeState({}), [writeState])

  return { background, canSet, setBackground, clearBackground }
}

// Turn a state-write rejection into something a person can act on. A 403 here
// means the room's state_default outranks the user, which is a permission
// problem and not a transient one worth retrying.
export function describeBackgroundError(err: unknown): string {
  const e = err as { httpStatus?: number; errcode?: string; message?: string }
  if (e?.httpStatus === 403 || e?.errcode === 'M_FORBIDDEN') {
    return 'You do not have permission to set the background for this domain.'
  }
  if (e?.errcode === 'M_LIMIT_EXCEEDED') return 'Rate-limited by the server. Try again shortly.'
  if (e?.errcode === 'M_TOO_LARGE') return 'That image is too large for the server.'
  return e?.message ?? 'The background could not be saved.'
}
