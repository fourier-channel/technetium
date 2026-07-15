import { useEffect, useState } from 'react'
import { ClientEvent, NotificationCountType, RoomEvent, type MatrixClient } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// Live per-room notification counts. Returns a Map roomId -> { total, highlight }
// for joined rooms, refreshed (debounced) whenever a sync lands or the timeline
// moves -- which is exactly when the SDK's counts change. The nav tree reads
// this for the unread glow / (count) / ping treatment, and aggregates it up to
// collapsed space headers.
//
// State is seeded lazily and only ever updated from event callbacks / a timer,
// never synchronously in the effect body (React Compiler set-state-in-effect
// discipline).
// ---------------------------------------------------------------------------

export interface NotifCounts {
  total: number
  highlight: number
}
export type NotifMap = Map<string, NotifCounts>

function computeNotifMap(client: MatrixClient): NotifMap {
  const m: NotifMap = new Map()
  for (const room of client.getRooms()) {
    if (room.getMyMembership() !== 'join') continue
    const total = room.getUnreadNotificationCount(NotificationCountType.Total)
    const highlight = room.getUnreadNotificationCount(NotificationCountType.Highlight)
    if (total > 0 || highlight > 0) m.set(room.roomId, { total, highlight })
  }
  return m
}

export function useRoomNotifications(client: MatrixClient | null): NotifMap {
  const [map, setMap] = useState<NotifMap>(() => (client ? computeNotifMap(client) : new Map()))

  useEffect(() => {
    if (!client) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setMap(computeNotifMap(client)), 200)
    }
    // Initial compute is deferred through the timer (async), so it is not a
    // synchronous setState in the effect body.
    schedule()

    // Room-level events the client re-emits; the SDK's EmittedEvents union
    // doesn't enumerate them, so cast the names (runtime is correct).
    type ClientEv = Parameters<typeof client.on>[0]
    const RE_TIMELINE = RoomEvent.Timeline as unknown as ClientEv
    const RE_RECEIPT = RoomEvent.Receipt as unknown as ClientEv
    const RE_UNREAD = RoomEvent.UnreadNotifications as unknown as ClientEv

    client.on(ClientEvent.Sync, schedule)
    client.on(ClientEvent.Room, schedule)
    client.on(RE_TIMELINE, schedule)
    client.on(RE_RECEIPT, schedule)
    client.on(RE_UNREAD, schedule)
    return () => {
      if (timer) clearTimeout(timer)
      client.off(ClientEvent.Sync, schedule)
      client.off(ClientEvent.Room, schedule)
      client.off(RE_TIMELINE, schedule)
      client.off(RE_RECEIPT, schedule)
      client.off(RE_UNREAD, schedule)
    }
  }, [client])

  return map
}
