import { useEffect, useState } from 'react'
import { RoomEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// Domain media-objects. A media post made IN domain mode is stamped by the
// composer with `net.41chan.domain_ttd` (seconds) -- that stamp both MARKS the
// post as a domain object and carries its lifetime. Here we derive the set of
// currently-live objects from the room timeline: any m.image with the stamp,
// younger than its ttd. Because they are read from timeline events (which
// persist), anyone who joins the domain during an object's ttd window sees it
// too, with no extra transport. Expiry ("depop") is a wall-clock filter, ticked
// once a second. (Per-post ttd is authoritative now; power-level control is v2.)
// ---------------------------------------------------------------------------

export const DOMAIN_TTD_FIELD = 'net.41chan.domain_ttd'
export const TTD_MIN = 1
export const TTD_MAX = 600
export const TTD_DEFAULT = 60

export interface DomainMediaObject {
  id: string // event id
  sender: string
  mxc: string
  name?: string
  mimetype?: string
  ts: number // event origin ts (ms)
  ttdMs: number // lifetime from ts
}

function clampTtd(s: number): number {
  return Math.max(TTD_MIN, Math.min(TTD_MAX, Math.round(s)))
}

function toObject(ev: MatrixEvent): DomainMediaObject | null {
  if (ev.getType() !== 'm.room.message' || ev.isRedacted()) return null
  const c = ev.getContent()
  if (c.msgtype !== 'm.image') return null
  const ttd = c[DOMAIN_TTD_FIELD]
  if (typeof ttd !== 'number') return null
  if (typeof c.url !== 'string' || !c.url) return null
  const id = ev.getId()
  const sender = ev.getSender()
  if (!id || !sender) return null
  const info = c.info as { mimetype?: unknown } | undefined
  return {
    id,
    sender,
    mxc: c.url,
    name:
      typeof c.filename === 'string' ? c.filename : typeof c.body === 'string' ? c.body : undefined,
    mimetype: info && typeof info.mimetype === 'string' ? info.mimetype : undefined,
    ts: ev.getTs(),
    ttdMs: clampTtd(ttd) * 1000,
  }
}

function scan(room: Room | null): DomainMediaObject[] {
  if (!room) return []
  const now = Date.now()
  const out: DomainMediaObject[] = []
  for (const ev of room.getLiveTimeline().getEvents()) {
    const obj = toObject(ev)
    if (obj && now - obj.ts < obj.ttdMs) out.push(obj)
  }
  return out
}

export function useDomainMedia(client: MatrixClient | null, room: Room | null): DomainMediaObject[] {
  const [objects, setObjects] = useState<DomainMediaObject[]>(() => scan(room))

  useEffect(() => {
    if (!client || !room) return
    const refresh = () => setObjects(scan(room))
    const t = setTimeout(refresh, 0) // re-scan on room change (async, not in body)

    const onTimeline = (_ev: MatrixEvent, evRoom: Room | undefined, toStart?: boolean) => {
      if (toStart) return
      if (evRoom?.roomId === room.roomId) refresh()
    }
    client.on(RoomEvent.Timeline, onTimeline)
    // Wall-clock expiry: re-filter once a second so objects depop on schedule.
    const tick = setInterval(refresh, 1000)
    return () => {
      clearTimeout(t)
      clearInterval(tick)
      client.off(RoomEvent.Timeline, onTimeline)
    }
  }, [client, room])

  return objects
}
