import { useCallback, useEffect, useState } from 'react'
import { RoomEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk'
import { DOMAIN_ADMIN_PL } from '../ui/domainRoles'

// ---------------------------------------------------------------------------
// Domain moderation: an admin/mod (PL >= DOMAIN_ADMIN_PL) can force-collapse a
// user -- kick them out of the visible space. Transport is a custom TIMELINE
// event (`net.41chan.domain.force_collapse` { target }); clients honor it ONLY
// when the SENDER is actually an admin (verified against room power levels), so
// a PL0 user can't forge a kick. The collapse holds until the target re-asserts
// a NEWER position (re-placing themselves returns them). Kept separate from the
// roompos SSOT so positions stay a clean single source of truth.
// ---------------------------------------------------------------------------

export const DOMAIN_FORCE_COLLAPSE_EVENT = 'net.41chan.domain.force_collapse'

function senderIsAdmin(room: Room, sender: string | undefined): boolean {
  if (!sender) return false
  return (room.getMember(sender)?.powerLevel ?? 0) >= DOMAIN_ADMIN_PL
}

// Map target userId -> ts of the most recent admin-issued collapse.
function scan(room: Room | null): Map<string, number> {
  const m = new Map<string, number>()
  if (!room) return m
  for (const ev of room.getLiveTimeline().getEvents()) {
    if (ev.getType() !== DOMAIN_FORCE_COLLAPSE_EVENT) continue
    if (!senderIsAdmin(room, ev.getSender())) continue
    const target = ev.getContent().target
    if (typeof target !== 'string') continue
    const ts = ev.getTs()
    const prev = m.get(target)
    if (prev === undefined || ts > prev) m.set(target, ts)
  }
  return m
}

export interface DomainModerationApi {
  // target userId -> collapse ts. A puck is hidden when its collapse ts is >=
  // the user's latest position ts (compared by the consumer).
  collapsed: Map<string, number>
  forceCollapse: (userId: string) => void
}

export function useDomainModeration(
  client: MatrixClient | null,
  room: Room | null,
): DomainModerationApi {
  const [collapsed, setCollapsed] = useState<Map<string, number>>(() => scan(room))

  useEffect(() => {
    if (!client || !room) return
    const t = setTimeout(() => setCollapsed(scan(room)), 0)
    const onTimeline = (ev: MatrixEvent, evRoom: Room | undefined) => {
      if (evRoom?.roomId !== room.roomId) return
      if (ev.getType() !== DOMAIN_FORCE_COLLAPSE_EVENT) return
      if (!senderIsAdmin(room, ev.getSender())) return
      const target = ev.getContent().target
      if (typeof target !== 'string') return
      const ts = ev.getTs()
      setCollapsed((prev) => {
        if ((prev.get(target) ?? 0) >= ts) return prev
        return new Map(prev).set(target, ts)
      })
    }
    client.on(RoomEvent.Timeline, onTimeline)
    return () => {
      clearTimeout(t)
      client.off(RoomEvent.Timeline, onTimeline)
    }
  }, [client, room])

  const forceCollapse = useCallback(
    (userId: string) => {
      if (!client || !room) return
      // Custom event via a bound, loosely-typed alias (cf. G-bf03).
      const send = client.sendEvent.bind(client) as unknown as (
        roomId: string,
        eventType: string,
        content: Record<string, unknown>,
      ) => Promise<unknown>
      void send(room.roomId, DOMAIN_FORCE_COLLAPSE_EVENT, { target: userId }).catch(() => {
        // best-effort; UI already reflects intent optimistically on next scan
      })
    },
    [client, room],
  )

  return { collapsed, forceCollapse }
}
