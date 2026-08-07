import { useCallback, useEffect, useState } from 'react'
import { EventType, RoomStateEvent, type MatrixClient, type Room } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// W2.7 -- pinned messages.
//
// `m.room.pinned_events` is ROOM STATE holding an ordered list of event ids.
// Two consequences shape everything here:
//
//   1. Writing it replaces the WHOLE list, so pin/unpin is read-modify-write.
//      Two people pinning at once means the second write wins and the first
//      pin vanishes -- unavoidable without a server-side patch operation, but
//      the window is small because we re-read state immediately before writing
//      rather than trusting a value captured at render.
//   2. It is state, not a relation, so it is gated by power level like any
//      other state event.
// ---------------------------------------------------------------------------

function readPinned(room: Room | null): string[] {
  if (!room) return []
  const ev = room.currentState.getStateEvents(EventType.RoomPinnedEvents, '')
  if (!ev) return []
  const pinned = ev.getContent()?.pinned
  if (!Array.isArray(pinned)) return []
  return pinned.filter((id): id is string => typeof id === 'string')
}

export interface PinnedApi {
  pinned: string[]
  // False when the local user's power level cannot write the state event. The
  // Pin verb is hidden rather than shown-and-403ing.
  canPin: boolean
  toggle: (eventId: string) => Promise<void>
}

export function usePinnedEvents(client: MatrixClient | null, room: Room | null): PinnedApi {
  const [pinned, setPinned] = useState<string[]>([])
  const [canPin, setCanPin] = useState(false)

  useEffect(() => {
    if (!client || !room) {
      queueMicrotask(() => {
        setPinned([])
        setCanPin(false)
      })
      return
    }
    let cancelled = false
    const myUserId = client.getUserId()

    const refresh = () => {
      if (cancelled) return
      setPinned(readPinned(room))
      setCanPin(
        !!myUserId && room.currentState.maySendStateEvent(EventType.RoomPinnedEvents, myUserId),
      )
    }

    queueMicrotask(refresh)

    // Fires for any state change in any room; filter to ours. Power levels
    // change through this path too, so canPin tracks a promotion live.
    const onState = () => refresh()
    client.on(RoomStateEvent.Events, onState)
    return () => {
      cancelled = true
      client.off(RoomStateEvent.Events, onState)
    }
  }, [client, room])

  const toggle = useCallback(
    async (eventId: string) => {
      if (!client || !room) return
      // Re-read from state rather than using the rendered value: this is a
      // read-modify-write on a whole-list state event, so the freshest list
      // narrows the window in which a concurrent pin is lost.
      const current = readPinned(room)
      const next = current.includes(eventId)
        ? current.filter((id) => id !== eventId)
        : [...current, eventId]
      try {
        await client.sendStateEvent(room.roomId, EventType.RoomPinnedEvents, { pinned: next }, '')
      } catch (err) {
        console.error('Pin update failed:', err)
      }
    },
    [client, room],
  )

  return { pinned, canPin, toggle }
}
