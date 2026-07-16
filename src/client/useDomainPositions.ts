import { useCallback, useEffect, useRef, useState } from 'react'
import { RoomEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// roompos -- the single source of truth for domain-mode positions.
//
// Canonical unit is a NORMALIZED (x, y) in [0,1], deliberately scale-free: the
// store never knows about pixels. Every renderer projects [0,1] onto its own
// rect at its own scale, so multiple UI surfaces at different sizes stay in
// agreement (there is one truth; there are many projections). Positions can be
// read as a snapshot (`positions`) at any time, or observed live via the
// timeline subscription -- the basis for reporting on a cadence or on request.
//
// Transport: positions ride the room TIMELINE as custom events
// (`net.41chan.spatial.position`) so REGULAR users can broadcast them (custom
// timeline events are allowed at events_default / PL0, unlike state events which
// usually need PL50). useTimeline filters these out of the chat log.
//
// Presence (the "spot saver"): each position event also carries a `present`
// boolean. Entering the domain re-asserts present:true at your saved spot;
// collapsing the domain releases present:false at your last spot -- so other
// clients keep showing WHERE you were, desaturated, until you return. The
// local user's own position is mirrored to localStorage so re-entry restores it
// and the self avatar renders immediately without waiting for the echo.
// ---------------------------------------------------------------------------

// Wire + storage namespace stays `net.41chan.spatial.*` (historical name; the
// feature is now "domain mode") -- these are protocol/persistence identifiers
// already live in production, so renaming them would orphan deployed data.
export const DOMAIN_POSITION_EVENT = 'net.41chan.spatial.position'
const LOCAL_KEY = 'net.41chan.spatial_local'
const SEND_THROTTLE_MS = 160
// Matrix canonical JSON forbids floats, so positions go on the wire as integers
// in [0, POS_SCALE] (a permyriad of the canvas) and are divided back to [0,1].
const POS_SCALE = 10000

export interface DomainPos {
  x: number
  y: number
  ts: number
  // false => the user explicitly collapsed the domain; render their last spot
  // desaturated. Absent-on-the-wire is treated as present (older clients).
  present: boolean
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

function parsePos(ev: MatrixEvent): DomainPos | null {
  const c = ev.getContent()
  if (typeof c.x !== 'number' || typeof c.y !== 'number') return null
  // Wire is integer permyriad; divide back to [0,1]. `present` defaults true so
  // events from clients that predate the flag still render as present.
  const present = c.present !== false
  return { x: clamp01(c.x / POS_SCALE), y: clamp01(c.y / POS_SCALE), ts: ev.getTs(), present }
}

// Build the current positions map from the room timeline (last per sender),
// overlaying the local user's persisted position.
function scan(client: MatrixClient | null, room: Room | null): Map<string, DomainPos> {
  const m = new Map<string, DomainPos>()
  if (!room) return m
  for (const ev of room.getLiveTimeline().getEvents()) {
    if (ev.getType() !== DOMAIN_POSITION_EVENT) continue
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
      // Prefer the local record only if we don't have a newer echoed one. On
      // fresh entry we render ourselves present at the saved spot.
      if (!existing) m.set(me, { x: clamp01(local.x), y: clamp01(local.y), ts: 0, present: true })
    }
  }
  return m
}

export interface DomainPositionsApi {
  positions: Map<string, DomainPos>
  myUserId: string | null
  setMyPosition: (x: number, y: number) => void
}

export function useDomainPositions(
  client: MatrixClient | null,
  room: Room | null,
): DomainPositionsApi {
  const [positions, setPositions] = useState<Map<string, DomainPos>>(() => scan(client, room))
  const myUserId = client?.getUserId() ?? null

  // Throttled trailing send so drag-to-move doesn't spam the timeline.
  const pendingRef = useRef<{ x: number; y: number } | null>(null)
  const lastSentRef = useRef(0)
  const sendTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Last position we know for self, so presence signals (enter/collapse) can be
  // sent at the right spot even if the user never moved this session.
  const selfPosRef = useRef<{ x: number; y: number } | null>(null)

  // Low-level custom-event send. The SDK's sendEvent is typed to known event
  // names, so reach it through a loosely-typed alias. MUST bind to the client --
  // sendEvent uses `this` internally (this.addThreadRelationIfNeeded), so a
  // detached reference throws.
  const rawSend = useCallback(
    (content: Record<string, unknown>) => {
      if (!client || !room) return
      const send = client.sendEvent.bind(client) as unknown as (
        roomId: string,
        eventType: string,
        content: Record<string, unknown>,
      ) => Promise<unknown>
      void send(room.roomId, DOMAIN_POSITION_EVENT, content).catch(() => {
        // send may fail (permissions/offline); local + optimistic state still hold
      })
    },
    [client, room],
  )

  // Fire a presence signal at the last known self position (integer wire format).
  const sendPresence = useCallback(
    (present: boolean) => {
      const p = selfPosRef.current
      if (!p) return
      rawSend({ x: Math.round(p.x * POS_SCALE), y: Math.round(p.y * POS_SCALE), present })
    },
    [rawSend],
  )

  const flushSend = useCallback(() => {
    const p = pendingRef.current
    if (!p) return
    pendingRef.current = null
    lastSentRef.current = Date.now()
    // Moving implies presence.
    rawSend({ x: Math.round(p.x * POS_SCALE), y: Math.round(p.y * POS_SCALE), present: true })
  }, [rawSend])

  const setMyPosition = useCallback(
    (x: number, y: number) => {
      const cx = clamp01(x)
      const cy = clamp01(y)
      const me = client?.getUserId()
      if (!me || !room) return
      selfPosRef.current = { x: cx, y: cy }
      setPositions((prev) => new Map(prev).set(me, { x: cx, y: cy, ts: Date.now(), present: true }))
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

    // Seed self position from the local mirror and re-assert presence on entry:
    // if we saved a spot here, tell the room "I'm back" so a prior collapse's
    // present:false is superseded and others un-desaturate us.
    const me = client.getUserId()
    const localSelf = me ? readLocal()[room.roomId] : undefined
    let entered = false
    if (localSelf) {
      selfPosRef.current = { x: clamp01(localSelf.x), y: clamp01(localSelf.y) }
      sendPresence(true)
      entered = true
    }

    const onTimeline = (ev: MatrixEvent, evRoom: Room | undefined) => {
      if (evRoom?.roomId !== room.roomId) return
      if (ev.getType() !== DOMAIN_POSITION_EVENT) return
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
      // Collapse: release presence at the last spot so others keep our position
      // but render it desaturated ("was here"). Only if we ever asserted it.
      if (entered) sendPresence(false)
    }
  }, [client, room, sendPresence])

  return { positions, myUserId, setMyPosition }
}
