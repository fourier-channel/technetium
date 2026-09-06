// ---------------------------------------------------------------------------
// The space. Pure geometry, no React.
//
// Operator model 2026-09-06. The UI is the unit square, "1", and every panel
// is a rectangle in it; together they TILE it -- areas sum to one, nothing
// overlaps. What the user drags is never a panel. It is a DIVIDER: a maximal
// line of coincident panel edges. Moving it moves every edge on it, and the
// panels on both sides grow or shrink to accommodate. The size bars are the
// elements; the panels are what is left between them.
//
// Two constraints, individually or together:
//   LOCKED  -- width and height immutable. Push one edge and the opposite edge
//              moves the same way: the panel translates, and the push carries
//              on to the next divider.
//   PINNED  -- the center immutable. Push one edge by d and the opposite edge
//              moves by -d: the panel warps symmetrically, and the reflection
//              carries on.
//   both    -- a fixed object; the rest divide the remainder.
//
// A push that cannot be honoured -- it reaches the space's boundary, needs a
// divider to move two different ways, or would take a panel under its
// minimum -- is not refused outright: the largest feasible part of it is
// applied, found by bisection, so a drag runs up to the wall and stops.
//
// LAST VECTOR WINS. A divider drag is unambiguous. A change aimed at a PANEL
// (grow it to a size) is not: which edge, and in the 2-D case which axis. The
// axis and direction of the last drag that touched the panel decide.
// ---------------------------------------------------------------------------

export type Axis = 'x' | 'y'
export type Dir = -1 | 1
export type PanelId = 'sidebar' | 'main' | 'dock' | 'thread' | 'members' | 'domain'
export const PANEL_IDS: PanelId[] = ['sidebar', 'main', 'dock', 'thread', 'members', 'domain']

export interface Rect { x0: number; y0: number; x1: number; y1: number }

export interface Leaf extends Rect {
  id: PanelId
  locked: boolean
  pinned: boolean
  open: boolean
  // Minimum extent along each axis, as a fraction of the space.
  min: number
  last: { axis: Axis; dir: Dir } | null
}

export interface Space {
  v: 2
  leaves: Record<PanelId, Leaf>
}

export const DEFAULT_MIN = 0.1
const EPS = 1e-6
const near = (a: number, b: number) => Math.abs(a - b) < EPS

// The preset: sidebar | (dock over main) | members. Thread and domain exist
// closed. The dock is LOCKED -- its size is guaranteed, which is what "the DM
// wins" needs -- but not pinned: a locked+pinned dock spanning the column is
// a fixed object whose edges freeze the sidebar and member dividers for as
// long as a DM is open, which reads as "the sidebar is broken", not as a
// design. Pinning stays a deliberate choice, and then it freezes exactly that.
export function defaultSpace(): Space {
  const leaf = (id: PanelId, r: Rect, extra: Partial<Leaf> = {}): Leaf =>
    ({ id, ...r, locked: false, pinned: false, open: true, min: DEFAULT_MIN, last: null, ...extra })
  return {
    v: 2,
    leaves: {
      sidebar: leaf('sidebar', { x0: 0, y0: 0, x1: 0.18, y1: 1 }),
      dock:    leaf('dock',    { x0: 0.18, y0: 0, x1: 0.85, y1: 0.28 }, { locked: true, open: false }),
      main:    leaf('main',    { x0: 0.18, y0: 0, x1: 0.85, y1: 1 }),
      thread:  leaf('thread',  { x0: 0.85, y0: 0, x1: 0.85, y1: 1 }, { open: false }),
      members: leaf('members', { x0: 0.85, y0: 0, x1: 1, y1: 1 }),
      domain:  leaf('domain',  { x0: 0.18, y0: 0, x1: 0.18, y1: 1 }, { open: false }),
    },
  }
}

export function openLeaves(s: Space): Leaf[] {
  return PANEL_IDS.map((id) => s.leaves[id]).filter((l) => l.open)
}

function clone(s: Space): Space {
  const leaves = {} as Record<PanelId, Leaf>
  for (const id of PANEL_IDS) leaves[id] = { ...s.leaves[id], last: s.leaves[id].last ? { ...s.leaves[id].last! } : null }
  return { v: 2, leaves }
}

const lo = (l: Rect, a: Axis) => (a === 'x' ? l.x0 : l.y0)
const hi = (l: Rect, a: Axis) => (a === 'x' ? l.x1 : l.y1)
const setLo = (l: Rect, a: Axis, v: number) => { if (a === 'x') l.x0 = v; else l.y0 = v }
const setHi = (l: Rect, a: Axis, v: number) => { if (a === 'x') l.x1 = v; else l.y1 = v }
const extent = (l: Rect, a: Axis) => hi(l, a) - lo(l, a)

// Is the tiling valid: every open leaf inside the square with positive size,
// areas summing to one, no two overlapping.
export function validTiling(s: Space): boolean {
  const ls = openLeaves(s)
  let area = 0
  for (const l of ls) {
    if (l.x0 < -EPS || l.y0 < -EPS || l.x1 > 1 + EPS || l.y1 > 1 + EPS) return false
    if (l.x1 - l.x0 <= EPS || l.y1 - l.y0 <= EPS) return false
    area += (l.x1 - l.x0) * (l.y1 - l.y0)
  }
  if (!near(area, 1)) return false
  for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) {
    const a = ls[i], b = ls[j]
    const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
    const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
    if (ox > EPS && oy > EPS) return false
  }
  return true
}

// Every divider: an axis and a coordinate strictly inside the space that some
// open leaf edge lies on. Boundaries are not dividers.
export function dividers(s: Space): { axis: Axis; at: number }[] {
  const out: { axis: Axis; at: number }[] = []
  for (const axis of ['x', 'y'] as Axis[]) {
    const coords: number[] = []
    for (const l of openLeaves(s)) for (const c of [lo(l, axis), hi(l, axis)]) {
      if (c > EPS && c < 1 - EPS && !coords.some((k) => near(k, c))) coords.push(c)
    }
    for (const at of coords.sort((a, b) => a - b)) out.push({ axis, at })
  }
  return out
}

// Plan the edge moves a divider push implies, following lock/pin through the
// panels it meets. Returns null when the push cannot be honoured at all.
function plan(s: Space, axis: Axis, at: number, delta: number): Map<number, number> | null {
  const moves = new Map<number, number>() // divider coordinate -> delta
  const queue: { at: number; delta: number }[] = [{ at, delta }]
  while (queue.length) {
    const cur = queue.shift()!
    if (cur.at < EPS || cur.at > 1 - EPS) return null // the wall
    const key = [...moves.keys()].find((k) => near(k, cur.at))
    if (key !== undefined) {
      if (!near(moves.get(key)!, cur.delta)) return null // two different ways
      continue
    }
    moves.set(cur.at, cur.delta)
    for (const l of openLeaves(s)) {
      const onLo = near(lo(l, axis), cur.at), onHi = near(hi(l, axis), cur.at)
      if (!onLo && !onHi) continue
      if (l.locked && l.pinned) return null // a fixed object
      if (l.locked) queue.push({ at: onLo ? hi(l, axis) : lo(l, axis), delta: cur.delta })
      else if (l.pinned) queue.push({ at: onLo ? hi(l, axis) : lo(l, axis), delta: -cur.delta })
    }
  }
  return moves
}

function apply(s: Space, axis: Axis, moves: Map<number, number>): Space {
  const next = clone(s)
  for (const l of openLeaves(next)) {
    for (const [at, d] of moves) {
      if (near(lo(l, axis), at)) setLo(l, axis, lo(l, axis) + d)
      if (near(hi(l, axis), at)) setHi(l, axis, hi(l, axis) + d)
    }
  }
  return next
}

function feasible(s: Space): boolean {
  if (!validTiling(s)) return false
  return openLeaves(s).every((l) => extent(l, 'x') >= l.min - EPS && extent(l, 'y') >= l.min - EPS)
}

// Move the divider on `axis` at `at` by `delta` (fractions of the space).
// Applies the largest feasible part of the push.
export function moveDivider(s: Space, axis: Axis, at: number, delta: number): Space {
  if (near(delta, 0)) return s
  const attempt = (d: number): Space | null => {
    const m = plan(s, axis, at, d)
    if (!m) return null
    const n = apply(s, axis, m)
    return feasible(n) ? n : null
  }
  let result = attempt(delta)
  if (!result) {
    // Bisect toward the wall.
    let good = 0, bad = delta
    for (let i = 0; i < 24; i++) {
      const mid = (good + bad) / 2
      if (attempt(mid)) good = mid; else bad = mid
    }
    if (near(good, 0)) return s
    result = attempt(good)!
  }
  // Remember the vector on every panel the divider touched.
  for (const l of openLeaves(result)) {
    const before = s.leaves[l.id]
    if (!near(extent(before, axis), extent(l, axis)) || !near(lo(before, axis), lo(l, axis))) {
      l.last = { axis, dir: delta > 0 ? 1 : -1 }
    }
  }
  return result
}

// Change a PANEL's extent along an axis. Which edge moves is the ambiguity
// that last-vector-wins settles: the direction of the last drag that touched
// this panel; failing that, the edge nearer the middle of the space.
export function resizePanel(s: Space, id: PanelId, delta: number, axis?: Axis): Space {
  const l = s.leaves[id]
  if (!l.open || l.locked || near(delta, 0)) return s
  const ax: Axis = axis ?? l.last?.axis ?? 'x'
  let dir: Dir
  if (l.last && l.last.axis === ax) dir = l.last.dir
  else dir = (lo(l, ax) + hi(l, ax)) / 2 < 0.5 ? 1 : -1
  // Growing rightward/downward moves the high edge by +delta; growing the
  // other way moves the low edge by -delta.
  return dir === 1 ? moveDivider(s, ax, hi(l, ax), delta) : moveDivider(s, ax, lo(l, ax), -delta)
}

// Push one of a panel's edges. Resolved against the space it is applied to,
// so a drag's later steps find the divider where it now is, not where it was
// when the pointer went down.
export type Side = 'lo' | 'hi'
export function pushEdge(s: Space, id: PanelId, axis: Axis, side: Side, delta: number): Space {
  const l = s.leaves[id]
  if (!l.open) return s
  return moveDivider(s, axis, side === 'hi' ? hi(l, axis) : lo(l, axis), delta)
}

export function setFlag(s: Space, id: PanelId, flag: 'locked' | 'pinned', value: boolean): Space {
  if (s.leaves[id][flag] === value) return s
  const n = clone(s)
  n.leaves[id][flag] = value
  return n
}

export function setMin(s: Space, id: PanelId, min: number): Space {
  const n = clone(s)
  n.leaves[id].min = Math.max(0, Math.min(0.5, min))
  return n
}

// Open a closed panel by carving it out of `from`, which must span the same
// cross extent. `fraction` of `from`'s extent along `axis` goes to it, on the
// low side (dock over main, thread left of members) unless `atHigh`.
export function openPanel(s: Space, id: PanelId, from: PanelId, axis: Axis, fraction: number, atHigh = false): Space {
  const l = s.leaves[id], f = s.leaves[from]
  if (l.open || !f.open) return s
  const n = clone(s)
  const t = n.leaves[id], src = n.leaves[from]
  const cut = extent(src, axis) * Math.max(0.05, Math.min(0.9, fraction))
  // Same cross extent as the source.
  const cross: Axis = axis === 'x' ? 'y' : 'x'
  setLo(t, cross, lo(src, cross)); setHi(t, cross, hi(src, cross))
  if (atHigh) {
    setLo(t, axis, hi(src, axis) - cut); setHi(t, axis, hi(src, axis)); setHi(src, axis, hi(src, axis) - cut)
  } else {
    setLo(t, axis, lo(src, axis)); setHi(t, axis, lo(src, axis) + cut); setLo(src, axis, lo(src, axis) + cut)
  }
  t.open = true
  return feasible(n) ? n : s
}

// Close a panel: its space goes to the neighbour that shares its full edge
// along the panel's last axis (or x), so the tiling stays whole.
export function closePanel(s: Space, id: PanelId): Space {
  const l = s.leaves[id]
  if (!l.open) return s
  const n = clone(s)
  const t = n.leaves[id]
  const axes: Axis[] = l.last ? [l.last.axis, l.last.axis === 'x' ? 'y' : 'x'] : ['x', 'y']
  for (const axis of axes) {
    const cross: Axis = axis === 'x' ? 'y' : 'x'
    for (const nb of openLeaves(n)) {
      if (nb.id === id) continue
      const sameCross = near(lo(nb, cross), lo(t, cross)) && near(hi(nb, cross), hi(t, cross))
      if (!sameCross) continue
      if (near(lo(nb, axis), hi(t, axis))) { setLo(nb, axis, lo(t, axis)); t.open = false; return n }
      if (near(hi(nb, axis), lo(t, axis))) { setHi(nb, axis, hi(t, axis)); t.open = false; return n }
    }
  }
  return s // nothing can take the space; it stays open
}

// --- the number -----------------------------------------------------------
// Per leaf: x0,y0,x1,y1 at 10 bits each (1/1023), flags open|pinned|locked
// (3 bits), min at 6 bits (1/63), last axis+dir (3 bits: none/x-/x+/y-/y+).
// Six leaves in PANEL_IDS order, version 2 first, checksum byte last.
const Q = 1023n
const LEAF_BITS = 40n + 3n + 6n + 3n

function q(v: number): bigint { return BigInt(Math.max(0, Math.min(1023, Math.round(v * 1023)))) }
function checksum(x: bigint): bigint { let s = 0n, v = x; while (v > 0n) { s = (s + (v & 0xffn)) & 0xffn; v >>= 8n } return s }

export function serialize(s: Space): string {
  let acc = 2n
  for (const id of PANEL_IDS) {
    const l = s.leaves[id]
    const last = l.last ? BigInt((l.last.axis === 'x' ? 1 : 3) + (l.last.dir === 1 ? 1 : 0)) : 0n
    const flags = (l.open ? 4n : 0n) | (l.pinned ? 2n : 0n) | (l.locked ? 1n : 0n)
    const min = BigInt(Math.round(Math.max(0, Math.min(0.5, l.min)) * 126))
    let chunk = (((q(l.x0) << 10n) | q(l.y0)) << 20n) | (q(l.x1) << 10n) | q(l.y1)
    chunk = (chunk << 3n) | flags
    chunk = (chunk << 6n) | min
    chunk = (chunk << 3n) | last
    acc = (acc << LEAF_BITS) | chunk
  }
  acc = (acc << 8n) | checksum(acc)
  return acc.toString(10)
}

export function deserialize(code: string): Space | null {
  const t = code.trim()
  if (!/^\d{1,120}$/.test(t)) return null
  let acc: bigint
  try { acc = BigInt(t) } catch { return null }
  const sum = acc & 0xffn
  acc >>= 8n
  if (checksum(acc) !== sum) return null
  const s = defaultSpace()
  for (const id of [...PANEL_IDS].reverse()) {
    const chunk = acc & ((1n << LEAF_BITS) - 1n)
    acc >>= LEAF_BITS
    const last = Number(chunk & 7n)
    const min = Number((chunk >> 3n) & 63n) / 126
    const flags = Number((chunk >> 9n) & 7n)
    const rect = chunk >> 12n
    const y1 = Number(rect & Q) / 1023, x1 = Number((rect >> 10n) & Q) / 1023
    const y0 = Number((rect >> 20n) & Q) / 1023, x0 = Number((rect >> 30n) & Q) / 1023
    const l = s.leaves[id]
    Object.assign(l, { x0, y0, x1, y1, min, locked: !!(flags & 1), pinned: !!(flags & 2), open: !!(flags & 4) })
    l.last = last === 0 ? null : { axis: last <= 2 ? 'x' : 'y', dir: last % 2 === 0 ? 1 : -1 }
  }
  if (acc !== 2n) return null
  // Quantisation can leave a hair of overlap; snap coincident edges together.
  return validTiling(snap(s)) ? snap(s) : null
}

// Snap edge coordinates that quantisation split apart back onto one line.
function snap(s: Space): Space {
  const n = clone(s)
  for (const axis of ['x', 'y'] as Axis[]) {
    const coords: number[] = []
    for (const l of openLeaves(n)) for (const c of [lo(l, axis), hi(l, axis)]) {
      const k = coords.find((v) => Math.abs(v - c) < 2 / 1023)
      if (k === undefined) coords.push(c)
    }
    for (const l of openLeaves(n)) {
      const a = coords.find((v) => Math.abs(v - lo(l, axis)) < 2 / 1023)!
      const b = coords.find((v) => Math.abs(v - hi(l, axis)) < 2 / 1023)!
      setLo(l, axis, a < 2 / 1023 ? 0 : a); setHi(l, axis, b > 1 - 2 / 1023 ? 1 : b)
    }
  }
  return n
}

export function leafRect(s: Space, id: PanelId): Rect { const l = s.leaves[id]; return { x0: l.x0, y0: l.y0, x1: l.x1, y1: l.y1 } }
