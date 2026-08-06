import { useEffect, useRef } from 'react'
import { RoomEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk'
import { findReceiptableEvent } from './receipts'

// ---------------------------------------------------------------------------
// Mark the viewed room read. The base client never sent read receipts, so a
// room's unread notification count (and therefore the room-list glow / ping)
// stayed frozen at whatever it was on login -- opening the room did nothing.
//
// This sends an (unthreaded) read receipt for the latest event when a room is
// opened and whenever new live events arrive while it's the visible, open room.
// Gated on tab visibility so a backgrounded tab doesn't silently clear unreads.
// ---------------------------------------------------------------------------

export function useReadMarker(client: MatrixClient | null, room: Room | null): void {
  const lastSent = useRef<string | null>(null)

  useEffect(() => {
    if (!client || !room) return
    lastSent.current = null

    // The walk-back rule itself lives in client/receipts.ts so the Wave 3
    // "mark as read" menu action receipts by identical rules; this hook keeps
    // only the visibility gate, the dedupe and the listener plumbing.
    const mark = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      const target = findReceiptableEvent(room)
      const id = target?.getId()
      if (!target || !id || id === lastSent.current) return
      lastSent.current = id
      // unthreaded=true clears the room's overall unread regardless of thread.
      void client.sendReadReceipt(target, undefined, true).catch(() => {})
    }

    mark()
    const onTimeline = (_ev: MatrixEvent, evRoom: Room | undefined) => {
      if (evRoom?.roomId === room.roomId) mark()
    }
    client.on(RoomEvent.Timeline, onTimeline)
    document.addEventListener('visibilitychange', mark)
    return () => {
      client.off(RoomEvent.Timeline, onTimeline)
      document.removeEventListener('visibilitychange', mark)
    }
  }, [client, room])
}
