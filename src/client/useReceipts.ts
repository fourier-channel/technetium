import { useEffect, useState } from 'react'
import { RoomEvent, type MatrixClient, type Room } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// W2.6 -- who has read up to which event.
//
// Built by walking MEMBERS, not events: each joined member has exactly one
// read-up-to marker, so this is O(members) regardless of how much history is
// loaded. Inverting it gives the "seen by" cluster its per-event list directly.
//
// The local user is excluded -- a row telling you that you have read it is
// noise, and every row would carry it.
// ---------------------------------------------------------------------------

// Receipt traffic is bursty in an active room; one rebuild per burst.
const DEBOUNCE_MS = 250

export type ReceiptMap = Map<string, string[]>

function build(room: Room, myUserId: string | null): ReceiptMap {
  const map: ReceiptMap = new Map()
  for (const member of room.getJoinedMembers()) {
    if (member.userId === myUserId) continue
    const eventId = room.getEventReadUpTo(member.userId)
    if (!eventId) continue
    const list = map.get(eventId)
    if (list) list.push(member.userId)
    else map.set(eventId, [member.userId])
  }
  return map
}

export function useRoomReceipts(client: MatrixClient | null, room: Room | null): ReceiptMap {
  const [map, setMap] = useState<ReceiptMap>(() => new Map())

  useEffect(() => {
    if (!client || !room) {
      // Not a synchronous setState in the effect body (G-tc01).
      queueMicrotask(() => setMap(new Map()))
      return
    }

    let cancelled = false
    let pending: ReturnType<typeof setTimeout> | null = null

    const rebuild = () => {
      if (!cancelled) setMap(build(room, client.getUserId()))
    }
    const schedule = () => {
      if (pending !== null) return
      pending = setTimeout(() => {
        pending = null
        rebuild()
      }, DEBOUNCE_MS)
    }

    queueMicrotask(() => {
      if (!cancelled) rebuild()
    })

    const onReceipt = (_ev: unknown, evRoom: Room) => {
      if (evRoom.roomId === room.roomId) schedule()
    }
    client.on(RoomEvent.Receipt, onReceipt)
    return () => {
      cancelled = true
      if (pending !== null) clearTimeout(pending)
      client.off(RoomEvent.Receipt, onReceipt)
    }
  }, [client, room])

  return map
}
