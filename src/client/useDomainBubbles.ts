import { useEffect, useState } from 'react'
import { RoomEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// Domain-mode speech bubbles. When a live message lands, the sender's avatar
// shows a bubble with the text; it auto-expires after a readability-scaled
// duration (longer messages linger longer). One current bubble per user (a new
// message replaces the old). Backfilled/scrollback events are ignored so
// entering a room doesn't pop a burst of stale bubbles.
// ---------------------------------------------------------------------------

export interface Bubble {
  text: string
  id: string
}

const MAX_LEN = 160
const MIN_MS = 4000
const MAX_MS = 9000

function durationFor(len: number): number {
  return Math.max(MIN_MS, Math.min(MAX_MS, 3000 + len * 45))
}

export function useDomainBubbles(client: MatrixClient | null, room: Room | null): Map<string, Bubble> {
  const [bubbles, setBubbles] = useState<Map<string, Bubble>>(() => new Map())

  useEffect(() => {
    if (!client || !room) return
    const timers = new Map<string, ReturnType<typeof setTimeout>>()

    const onTimeline = (ev: MatrixEvent, evRoom: Room | undefined, toStart?: boolean) => {
      if (toStart) return
      if (evRoom?.roomId !== room.roomId) return
      if (ev.getType() !== 'm.room.message' || ev.isRedacted()) return
      // Skip backfill: only bubble genuinely fresh events.
      if (ev.getTs() < Date.now() - 15000) return
      const sender = ev.getSender()
      if (!sender) return
      const c = ev.getContent()
      const body = typeof c.body === 'string' ? c.body : ''
      const text = body.replace(/\s+/g, ' ').trim()
      if (!text) return
      const id = ev.getId() ?? String(ev.getTs())

      setBubbles((prev) => new Map(prev).set(sender, { text: text.slice(0, MAX_LEN), id }))

      const old = timers.get(sender)
      if (old) clearTimeout(old)
      const t = setTimeout(() => {
        timers.delete(sender)
        setBubbles((prev) => {
          const cur = prev.get(sender)
          if (!cur || cur.id !== id) return prev // superseded by a newer bubble
          const next = new Map(prev)
          next.delete(sender)
          return next
        })
      }, durationFor(text.length))
      timers.set(sender, t)
    }

    client.on(RoomEvent.Timeline, onTimeline)
    return () => {
      client.off(RoomEvent.Timeline, onTimeline)
      for (const t of timers.values()) clearTimeout(t)
    }
  }, [client, room])

  return bubbles
}
