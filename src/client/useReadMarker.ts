import { useEffect, useRef } from 'react'
import { RoomEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk'

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

    const mark = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      const events = room.getLiveTimeline().getEvents()
      // Walk back to the latest event that is safe to receipt: a fully-sent
      // event with a real id. Local echoes (status set, or a `~`-prefixed
      // transaction id) 400 the receipt endpoint, and our own spatial presence
      // events aren't "read" targets, so skip both.
      let target: MatrixEvent | undefined
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i]
        if (ev.status) continue // sending / not_sent local echo
        const eid = ev.getId()
        if (!eid || eid.startsWith('~')) continue
        if (ev.getType().startsWith('net.41chan.spatial.')) continue
        target = ev
        break
      }
      const id = target?.getId()
      if (!target || !id || id === lastSent.current) return
      lastSent.current = id
      // receiptType defaults to m.read; unthreaded=true clears the room's overall
      // unread regardless of thread.
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
