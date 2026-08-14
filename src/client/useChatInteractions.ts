import { useCallback, useEffect, useRef, useState } from 'react'
import { RoomEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk'
import {
  INTERACTION_EVENT,
  RATE_LIMIT_MS,
  parseInteraction,
  rateLimitOk,
  type ParsedInteraction,
} from './interactionEvents'
import { MAX_INTERACTION_MS, interactionById } from './interactionCatalog'
import { reportAlways } from './report'

// ---------------------------------------------------------------------------
// Chat interactions -- the transport half.
//
// Modelled on the deployed useDomainActions and deliberately separate from it:
// the domain event is in production and its consumers assume canvas
// coordinates, so sharing a wire type would mean every domain client parsing
// chat events it cannot place. What IS shared is the catalog and every rule
// about whether to believe a wire event, both of which are pure and checked.
//
// Ephemeral by construction. An interaction is only ever animated if it is
// live (age-gated in parseInteraction) and it self-expires after its own
// duration, so a room's history never replays a burst of yesterday's slaps.
// ---------------------------------------------------------------------------

export interface ActivePlay extends ParsedInteraction {
  // When it started, so the layer can compute progress if it needs to.
  startedAt: number
}

export interface ChatInteractionsApi {
  plays: ActivePlay[]
  // Returns false when the local rate limit refused it, so the UI can say so
  // rather than appearing to have done nothing.
  trigger: (action: string, target?: string) => boolean
  canTrigger: () => boolean
}

const EMPTY_PLAYS: ActivePlay[] = []

export function useChatInteractions(
  client: MatrixClient | null,
  room: Room | null,
): ChatInteractionsApi {
  const [plays, setPlays] = useState<ActivePlay[]>(EMPTY_PLAYS)
  // Ref, not state: this is bookkeeping, and re-rendering on every accepted
  // event would defeat the point of an overlay that does not touch the log.
  const lastBySender = useRef<Map<string, number>>(new Map())
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const myLastSend = useRef<number>(0)

  const expire = useCallback((key: string) => {
    setPlays((prev) => prev.filter((p) => p.key !== key))
    timers.current.delete(key)
  }, [])

  const admit = useCallback(
    (parsed: ParsedInteraction, now: number) => {
      // Receiver-side rate limit (D-in03). A client that ignores its own limit
      // -- or is patched not to have one -- still cannot flood this screen.
      if (!rateLimitOk(lastBySender.current.get(parsed.actor), now)) return
      lastBySender.current.set(parsed.actor, now)

      setPlays((prev) => {
        // Dedup our own optimistic play against its echo from the server.
        if (prev.some((p) => p.key === parsed.key)) return prev
        return [...prev, { ...parsed, startedAt: now }]
      })

      const existing = timers.current.get(parsed.key)
      if (existing) clearTimeout(existing)
      // Bounded by the catalog maximum as well as by the definition, so an
      // entry with an absurd duration cannot leak a node.
      const ttl = Math.min(parsed.def.durationMs, MAX_INTERACTION_MS) + 120
      timers.current.set(parsed.key, setTimeout(() => expire(parsed.key), ttl))
    },
    [expire],
  )

  useEffect(() => {
    if (!client || !room) return
    const roomId = room.roomId

    const onTimeline = (ev: MatrixEvent, evRoom: Room | undefined) => {
      if (evRoom?.roomId !== roomId) return
      if (ev.getType() !== INTERACTION_EVENT) return
      const parsed = parseInteraction({
        content: ev.getContent(),
        sender: ev.getSender(),
        eventId: ev.getId(),
        ts: ev.getTs(),
        now: Date.now(),
        surface: 'chat',
      })
      if (!parsed) return
      admit(parsed, Date.now())
    }

    client.on(RoomEvent.Timeline, onTimeline)
    return () => {
      client.off(RoomEvent.Timeline, onTimeline)
    }
  }, [client, room, admit])

  // Clear everything when the room changes: an interaction aimed at somebody
  // in another room has nothing to anchor to here.
  useEffect(() => {
    const running = timers.current
    return () => {
      for (const t of running.values()) clearTimeout(t)
      running.clear()
    }
  }, [room])

  const canTrigger = useCallback(() => rateLimitOk(myLastSend.current || undefined, Date.now()), [])

  const trigger = useCallback(
    (action: string, target?: string): boolean => {
      if (!client || !room) return false
      const def = interactionById(action)
      if (!def || !def.surfaces.includes('chat')) return false
      const now = Date.now()
      if (!rateLimitOk(myLastSend.current || undefined, now)) return false
      myLastSend.current = now

      const me = client.getUserId() ?? ''
      // Instance id: distinct per play, so our optimistic render and the
      // server echo of the same send collapse to one.
      const id = `${me}:${now}:${action}`
      const content: Record<string, unknown> = { id, action }
      if (def.shape === 'targeted' && target) content.target = target

      // Optimistic local play, so it feels immediate rather than round-trip.
      if (me) {
        admit(
          {
            key: id,
            action,
            def,
            actor: me,
            target: def.shape === 'targeted' ? target : undefined,
          },
          now,
        )
      }

      const send = client.sendEvent.bind(client) as unknown as (
        roomId: string,
        eventType: string,
        body: Record<string, unknown>,
      ) => Promise<unknown>
      void send(room.roomId, INTERACTION_EVENT, content).catch((err) => {
        // The local play already happened, so the sender saw something -- but
        // nobody else did, and saying nothing would make a broken room look
        // like a quiet one (D-tp16).
        reportAlways('interaction: send', err)
      })
      return true
    },
    [client, room, admit],
  )

  return { plays, trigger, canTrigger }
}

export { RATE_LIMIT_MS }
