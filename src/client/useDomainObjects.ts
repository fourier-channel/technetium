import { useCallback, useEffect, useRef, useState } from 'react'
import { RoomEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk'
import { DOMAIN_ADMIN_PL } from '../ui/domainRoles'

// ---------------------------------------------------------------------------
// Detached canvas objects. A user can "detach" a posted image from their avatar
// and leave it on the domain canvas as a free-floating, moveable object. Unlike
// media-object cards (which spawn from a puck and depop by TTD), a detached
// object is PERSISTENT and INTERACTIVE: whoever is permitted can drag it around,
// and everyone sees it move.
//
// Transport (same PL0-safe choice as positions -- custom timeline events, so a
// regular user can create/move their own object without state-write power):
// `net.41chan.domain.object` events carry an `op`:
//   - create: { id, mxc, x, y, perm, allow?, name?, mimetype?, op:'create' }
//   - move:   { id, x, y, op:'move' }
//   - perm:   { id, perm, allow?, op:'perm' }
//   - remove: { id, op:'remove' }
// Current state = the events applied in order per id (first create wins).
//
// Permissions are enforced ON RECEIPT (like force-collapse, D-dm08 -- never
// trust send-side power over a PL0 transport):
//   - move is honored only if the sender may move the object (owner / admin /
//     everyone / whitelisted), evaluated against the object's CURRENT perm.
//   - perm/remove are honored only from the owner or an admin.
// x,y ride as integer permyriad [0,10000] (canonical JSON forbids floats).
// ---------------------------------------------------------------------------

export const DOMAIN_OBJECT_EVENT = 'net.41chan.domain.object'
const POS_SCALE = 10000
const MOVE_THROTTLE_MS = 120

export type MovePerm = 'everyone' | 'owner' | 'mods' | 'whitelist'

export interface DomainObject {
  id: string
  mxc: string
  x: number // [0,1]
  y: number // [0,1]
  owner: string
  perm: MovePerm
  allow: string[]
  name?: string
  mimetype?: string
  removed: boolean
}

interface ParsedEvent {
  id: string
  op: string
  sender: string
  content: Record<string, unknown>
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function memberPL(room: Room, userId: string): number {
  return room.getMember(userId)?.powerLevel ?? 0
}

function ownerOrAdmin(sender: string, obj: DomainObject, room: Room): boolean {
  return sender === obj.owner || memberPL(room, sender) >= DOMAIN_ADMIN_PL
}

function canMoveBy(sender: string, obj: DomainObject, room: Room): boolean {
  if (ownerOrAdmin(sender, obj, room)) return true
  if (obj.perm === 'everyone') return true
  if (obj.perm === 'whitelist') return obj.allow.includes(sender)
  return false // 'owner' / 'mods' -> only owner+admin, handled above
}

function normPerm(v: unknown): MovePerm {
  return v === 'owner' || v === 'mods' || v === 'whitelist' || v === 'everyone' ? v : 'everyone'
}

function parse(ev: MatrixEvent): ParsedEvent | null {
  if (ev.getType() !== DOMAIN_OBJECT_EVENT) return null
  const sender = ev.getSender()
  const content = ev.getContent() as Record<string, unknown>
  const id = content.id
  if (!sender || typeof id !== 'string' || !id) return null
  const op = typeof content.op === 'string' ? content.op : ''
  return { id, op, sender, content }
}

// Apply one parsed event into the objects map (mutates), enforcing permissions.
function applyInto(map: Map<string, DomainObject>, room: Room, e: ParsedEvent): void {
  const c = e.content
  if (e.op === 'create') {
    if (map.has(e.id)) return // first create wins
    if (typeof c.mxc !== 'string' || !c.mxc) return
    const x = typeof c.x === 'number' ? clamp01(c.x / POS_SCALE) : 0.5
    const y = typeof c.y === 'number' ? clamp01(c.y / POS_SCALE) : 0.5
    map.set(e.id, {
      id: e.id,
      mxc: c.mxc,
      x,
      y,
      owner: e.sender,
      perm: normPerm(c.perm),
      allow: Array.isArray(c.allow) ? (c.allow.filter((a) => typeof a === 'string') as string[]) : [],
      name: typeof c.name === 'string' ? c.name : undefined,
      mimetype: typeof c.mimetype === 'string' ? c.mimetype : undefined,
      removed: false,
    })
    return
  }
  const obj = map.get(e.id)
  if (!obj) return
  if (e.op === 'move') {
    if (typeof c.x !== 'number' || typeof c.y !== 'number') return
    if (canMoveBy(e.sender, obj, room)) {
      map.set(e.id, { ...obj, x: clamp01(c.x / POS_SCALE), y: clamp01(c.y / POS_SCALE) })
    }
  } else if (e.op === 'perm') {
    if (ownerOrAdmin(e.sender, obj, room)) {
      map.set(e.id, {
        ...obj,
        perm: normPerm(c.perm),
        allow: Array.isArray(c.allow) ? (c.allow.filter((a) => typeof a === 'string') as string[]) : obj.allow,
      })
    }
  } else if (e.op === 'remove') {
    if (ownerOrAdmin(e.sender, obj, room)) map.set(e.id, { ...obj, removed: true })
  }
}

function scan(room: Room | null): Map<string, DomainObject> {
  const map = new Map<string, DomainObject>()
  if (!room) return map
  for (const ev of room.getLiveTimeline().getEvents()) {
    const p = parse(ev)
    if (p) applyInto(map, room, p)
  }
  return map
}

export interface DomainObjectsApi {
  objects: DomainObject[]
  canMove: (obj: DomainObject) => boolean
  isOwnerOrAdmin: (obj: DomainObject) => boolean
  create: (o: { mxc: string; x: number; y: number; name?: string; mimetype?: string; perm?: MovePerm }) => void
  move: (id: string, x: number, y: number) => void
  setPerm: (id: string, perm: MovePerm, allow?: string[]) => void
  remove: (id: string) => void
}

export function useDomainObjects(client: MatrixClient | null, room: Room | null): DomainObjectsApi {
  const [objects, setObjects] = useState<Map<string, DomainObject>>(() => scan(room))
  const myUserId = client?.getUserId() ?? null

  // Per-object trailing throttle for move sends so a drag doesn't spam timeline.
  const moveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const pendingMove = useRef<Map<string, { x: number; y: number }>>(new Map())

  const rawSend = useCallback(
    (content: Record<string, unknown>) => {
      if (!client || !room) return
      const send = client.sendEvent.bind(client) as unknown as (
        roomId: string,
        eventType: string,
        content: Record<string, unknown>,
      ) => Promise<unknown>
      void send(room.roomId, DOMAIN_OBJECT_EVENT, content).catch(() => {
        // best-effort; optimistic local state already reflects the change
      })
    },
    [client, room],
  )

  const create = useCallback(
    (o: { mxc: string; x: number; y: number; name?: string; mimetype?: string; perm?: MovePerm }) => {
      if (!client || !room) return
      const id = crypto.randomUUID()
      rawSend({
        id,
        op: 'create',
        mxc: o.mxc,
        x: Math.round(clamp01(o.x) * POS_SCALE),
        y: Math.round(clamp01(o.y) * POS_SCALE),
        perm: o.perm ?? 'everyone',
        ...(o.name ? { name: o.name } : {}),
        ...(o.mimetype ? { mimetype: o.mimetype } : {}),
      })
      // Optimistic: reflect immediately (owner is us).
      const me = client.getUserId() ?? ''
      setObjects((prev) => {
        const next = new Map(prev)
        next.set(id, {
          id,
          mxc: o.mxc,
          x: clamp01(o.x),
          y: clamp01(o.y),
          owner: me,
          perm: o.perm ?? 'everyone',
          allow: [],
          name: o.name,
          mimetype: o.mimetype,
          removed: false,
        })
        return next
      })
    },
    [client, room, rawSend],
  )

  const move = useCallback(
    (id: string, x: number, y: number) => {
      const cx = clamp01(x)
      const cy = clamp01(y)
      // Optimistic local update.
      setObjects((prev) => {
        const obj = prev.get(id)
        if (!obj) return prev
        const next = new Map(prev)
        next.set(id, { ...obj, x: cx, y: cy })
        return next
      })
      // Throttle the wire send (trailing) per object.
      pendingMove.current.set(id, { x: cx, y: cy })
      if (!moveTimers.current.has(id)) {
        const timer = setTimeout(() => {
          moveTimers.current.delete(id)
          const p = pendingMove.current.get(id)
          pendingMove.current.delete(id)
          if (p) rawSend({ id, op: 'move', x: Math.round(p.x * POS_SCALE), y: Math.round(p.y * POS_SCALE) })
        }, MOVE_THROTTLE_MS)
        moveTimers.current.set(id, timer)
      }
    },
    [rawSend],
  )

  const setPerm = useCallback(
    (id: string, perm: MovePerm, allow?: string[]) => {
      rawSend({ id, op: 'perm', perm, ...(allow ? { allow } : {}) })
      setObjects((prev) => {
        const obj = prev.get(id)
        if (!obj) return prev
        const next = new Map(prev)
        next.set(id, { ...obj, perm, allow: allow ?? obj.allow })
        return next
      })
    },
    [rawSend],
  )

  const remove = useCallback(
    (id: string) => {
      rawSend({ id, op: 'remove' })
      setObjects((prev) => {
        const obj = prev.get(id)
        if (!obj) return prev
        const next = new Map(prev)
        next.set(id, { ...obj, removed: true })
        return next
      })
    },
    [rawSend],
  )

  useEffect(() => {
    if (!client || !room) return
    const timers = moveTimers.current
    const t = setTimeout(() => setObjects(scan(room)), 0)
    const onTimeline = (ev: MatrixEvent, evRoom: Room | undefined, toStart?: boolean) => {
      if (toStart) return
      if (evRoom?.roomId !== room.roomId) return
      const p = parse(ev)
      if (!p) return
      setObjects((prev) => {
        const next = new Map(prev)
        applyInto(next, room, p)
        return next
      })
    }
    client.on(RoomEvent.Timeline, onTimeline)
    return () => {
      clearTimeout(t)
      client.off(RoomEvent.Timeline, onTimeline)
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }, [client, room])

  const list = [...objects.values()].filter((o) => !o.removed)
  return {
    objects: list,
    canMove: (obj) => (myUserId ? (room ? canMoveBy(myUserId, obj, room) : false) : false),
    isOwnerOrAdmin: (obj) => (myUserId && room ? ownerOrAdmin(myUserId, obj, room) : false),
    create,
    move,
    setPerm,
    remove,
  }
}
