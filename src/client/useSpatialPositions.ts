import { useCallback, useEffect, useRef, useState } from 'react'
import { RoomEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// Spatial-mode position transport. Each participant's canvas position is a
// normalized (x, y) in [0,1]. Positions ride the room timeline as custom events
// (`net.41chan.spatial.position`) so REGULAR users can broadcast them (custom
// timeline events are allowed at events_default / PL0, unlike state events which
// usually need PL50). useTimeline filters these out of the chat log.
//
// The local user's own position is also persisted locally per room, so re-entry
// restores it and the self avatar renders immediately without waiting for the
// echo. Multi-user rendering is best-effort and needs a second live client to
// verify (flagged).
// ---------------------------------------------------------------------------

export const SPATIAL_POSITION_EVENT = 'net.41chan.spatial.position'
const LOCAL_KEY = 'net.41chan.spatial_local'
const SEND_THROTTLE_MS = 160
// Matrix canonical JSON forbids floats, so positions go on the wire as integers
// in [0, POS_SCALE] (a permyriad of the canvas) and are divided back to [0,1].
const POS_SCALE = 10000

export interface SpatialPos {
  x: number
  y: number
  ts: number
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function readLocal(): Record<string, { x: number; y: number }> {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return {}
    const p: unknown = JSON.parse(raw)
    return p && typeof p === 'object' ? (p as Record<string, { x: number; y: number }>) : {}
  } catch {
    return {}
  }
}

function saveLocal(roomId: string, pos: { x: number; y: number }): void {
  try {
    const all = readLocal()
    all[roomId] = pos
    localStorage.setItem(LOCAL_KEY, JSON.stringify(all))
  } catch {
    // best-effort
  }
}

function parsePos(ev: MatrixEvent): SpatialPos | null {
  const c = ev.getContent()
  if (typeof c.x !== 'number' || typeof c.y !== 'number') return null
  // Wire is integer permyriad; divide back to [0,1].
  return { x: clamp01(c.x / POS_SCALE), y: clamp01(c.y / POS_SCALE), ts: ev.getTs() }
}

// Build the current positions map from the room timeline (last per sender),
// overlaying the local user's persisted position.
function scan(client: MatrixClient | null, room: Room | null): Map<string, SpatialPos> {
  const m = new Map<string, SpatialPos>()
  if (!room) return m
  for (const ev of room.getLiveTimeline().getEvents()) {
    if (ev.getType() !== SPATIAL_POSITION_EVENT) continue
    const sender = ev.getSender()
    const pos = parsePos(ev)
    if (!sender || !pos) continue
    const prev = m.get(sender)
    if (!prev || pos.ts >= prev.ts) m.set(sender, pos)
  }
  const me = client?.getUserId()
  if (me) {
    const local = readLocal()[room.roomId]
    if (local) {
      const existing = m.get(me)
      // Prefer the local record only if we don't have a newer echoed one.
      if (!existing) m.set(me, { x: clamp01(local.x), y: clamp01(local.y), ts: 0 })
    }
  }
  return m
}

export interface SpatialPositionsApi {
  positions: Map<string, SpatialPos>
  myUserId: string | null
  setMyPosition: (x: number, y: number) => void
}

export function useSpatialPositions(
  client: MatrixClient | null,
  room: Room | null,
): SpatialPositionsApi {
  const [positions, setPositions] = useState<Map<string, SpatialPos>>(() => scan(client, room))
  const myUserId = client?.getUserId() ?? null

  // Throttled trailing send so drag-to-move doesn't spam the timeline.
  const pendingRef = useRef<{ x: number; y: number } | null>(null)
  const lastSentRef = useRef(0)
  const sendTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const flushSend = useCallback(() => {
    const p = pendingRef.current
    if (!p || !client || !room) return
    pendingRef.current = null
    lastSentRef.current = Date.now()
    // Custom event type: the SDK's sendEvent is typed to known event names, so
    // reach it through a loosely-typed alias. MUST bind to the client -- sendEvent
    // uses `this` internally (this.addThreadRelationIfNeeded), so a detached
    // reference throws.
    const send = client.sendEvent.bind(client) as unknown as (
      roomId: string,
      eventType: string,
      content: Record<string, unknown>,
    ) => Promise<unknown>
    // Integer wire format (Matrix rejects floats with M_BAD_JSON).
    const content = { x: Math.round(p.x * POS_SCALE), y: Math.round(p.y * POS_SCALE) }
    void send(room.roomId, SPATIAL_POSITION_EVENT, content).catch(() => {
      // send may fail (permissions/offline); local + optimistic state still hold
    })
  }, [client, room])

  const setMyPosition = useCallback(
    (x: number, y: number) => {
      const cx = clamp01(x)
      const cy = clamp01(y)
      const me = client?.getUserId()
      if (!me || !room) return
      setPositions((prev) => new Map(prev).set(me, { x: cx, y: cy, ts: Date.now() }))
      saveLocal(room.roomId, { x: cx, y: cy })

      pendingRef.current = { x: cx, y: cy }
      const since = Date.now() - lastSentRef.current
      if (since >= SEND_THROTTLE_MS) {
        flushSend()
      } else if (sendTimerRef.current === undefined) {
        sendTimerRef.current = setTimeout(() => {
          sendTimerRef.current = undefined
          flushSend()
        }, SEND_THROTTLE_MS - since)
      }
    },
    [client, room, flushSend],
  )

  useEffect(() => {
    if (!client || !room) return
    // Re-scan on room change through a timer (async), so this is not a
    // synchronous setState in the effect body.
    const t = setTimeout(() => setPositions(scan(client, room)), 0)

    const onTimeline = (ev: MatrixEvent, evRoom: Room | undefined) => {
      if (evRoom?.roomId !== room.roomId) return
      if (ev.getType() !== SPATIAL_POSITION_EVENT) return
      const sender = ev.getSender()
      const pos = parsePos(ev)
      if (!sender || !pos) return
      setPositions((prev) => {
        const existing = prev.get(sender)
        if (existing && existing.ts > pos.ts) return prev
        return new Map(prev).set(sender, pos)
      })
    }
    client.on(RoomEvent.Timeline, onTimeline)
    return () => {
      clearTimeout(t)
      if (sendTimerRef.current !== undefined) {
        clearTimeout(sendTimerRef.current)
        sendTimerRef.current = undefined
      }
      client.off(RoomEvent.Timeline, onTimeline)
    }
  }, [client, room])

  return { positions, myUserId, setMyPosition }
}
