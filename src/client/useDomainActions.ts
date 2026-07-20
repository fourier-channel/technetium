import { useCallback, useEffect, useRef, useState } from 'react'
import { RoomEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// Domain avatar ACTIONS -- ephemeral, emoji-like animations a user triggers on
// the canvas. A user fires a pre-programmed action; it broadcasts as a PL0
// timeline event (net.41chan.domain.action) and every client plays a short
// animation anchored to the sender's avatar (or, for a targeted action like a
// throw, flying from sender to target).
//
// This is SCAFFOLDING: the action list itself is deliberately TBD (per the
// operator -- do not invent the catalog). The registry below carries only two
// proof-of-concept entries -- a self 'square' (appears next to you, shrinks away
// after ~2s) and a targeted 'throw' (an item arcs across to another user). New
// actions are added by extending ACTION_REGISTRY + the render switch; the
// transport, freshness gating, and lifecycle here don't change.
//
// Actions are EPHEMERAL: only genuinely LIVE events animate (an age gate, like
// the domain-bubble mount grace, G-sr02) so entering a room doesn't replay a
// burst of stale actions. Each active action self-expires after its duration.
// ---------------------------------------------------------------------------

export const DOMAIN_ACTION_EVENT = 'net.41chan.domain.action'
// Only animate actions this fresh -- older ones are history, not live triggers.
const FRESH_WINDOW_MS = 8000

export type ActionKind = 'self' | 'throw'

export interface ActionDef {
  kind: ActionKind
  durationMs: number
  glyph: string
  label: string
}

// --- Scaffolding registry (POC only; the real catalog is TBD) ---------------
export const ACTION_REGISTRY: Record<string, ActionDef> = {
  square: { kind: 'self', durationMs: 2000, glyph: '⬛', label: 'Square' },
  throw: { kind: 'throw', durationMs: 950, glyph: '⭐', label: 'Throw ⭐' },
}

export interface ActiveAction {
  key: string // instance id (the wire `id`)
  action: string // registry key
  sender: string
  target?: string
  def: ActionDef
}

export interface DomainActionsApi {
  actions: ActiveAction[]
  trigger: (action: string, target?: string) => void
}

export function useDomainActions(client: MatrixClient | null, room: Room | null): DomainActionsApi {
  const [active, setActive] = useState<ActiveAction[]>([])
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const rawSend = useCallback(
    (content: Record<string, unknown>) => {
      if (!client || !room) return
      const send = client.sendEvent.bind(client) as unknown as (
        roomId: string,
        eventType: string,
        content: Record<string, unknown>,
      ) => Promise<unknown>
      void send(room.roomId, DOMAIN_ACTION_EVENT, content).catch(() => {
        // best-effort; the local optimistic play already happened
      })
    },
    [client, room],
  )

  const add = useCallback((a: ActiveAction) => {
    setActive((prev) => {
      if (prev.some((p) => p.key === a.key)) return prev // dedup (our echo)
      return [...prev, a]
    })
    const existing = timers.current.get(a.key)
    if (existing) clearTimeout(existing)
    const t = setTimeout(() => {
      timers.current.delete(a.key)
      setActive((prev) => prev.filter((p) => p.key !== a.key))
    }, a.def.durationMs)
    timers.current.set(a.key, t)
  }, [])

  const trigger = useCallback(
    (action: string, target?: string) => {
      const def = ACTION_REGISTRY[action]
      if (!def || !client) return
      const id = crypto.randomUUID()
      const me = client.getUserId() ?? ''
      rawSend({ id, action, ...(target ? { target } : {}) })
      add({ key: id, action, sender: me, target, def })
    },
    [client, rawSend, add],
  )

  useEffect(() => {
    if (!client || !room) return
    const localTimers = timers.current
    const onTimeline = (ev: MatrixEvent, evRoom: Room | undefined, toStart?: boolean) => {
      if (toStart) return
      if (evRoom?.roomId !== room.roomId) return
      if (ev.getType() !== DOMAIN_ACTION_EVENT) return
      if (Date.now() - ev.getTs() > FRESH_WINDOW_MS) return // history, not a live trigger
      const c = ev.getContent() as Record<string, unknown>
      const action = typeof c.action === 'string' ? c.action : ''
      const def = ACTION_REGISTRY[action]
      const sender = ev.getSender()
      const id = typeof c.id === 'string' ? c.id : ev.getId()
      if (!def || !sender || !id) return
      add({ key: id, action, sender, target: typeof c.target === 'string' ? c.target : undefined, def })
    }
    client.on(RoomEvent.Timeline, onTimeline)
    return () => {
      client.off(RoomEvent.Timeline, onTimeline)
      for (const t of localTimers.values()) clearTimeout(t)
      localTimers.clear()
    }
  }, [client, room, add])

  return { actions: active, trigger }
}
