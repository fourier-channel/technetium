// ---------------------------------------------------------------------------
// The real-estate model. Pure: no React, no DOM, no client.
//
// Operator design 2026-09-06, the start of the UI-customization phase. The
// screen is panels in two DOMAINS: a ROW (sidebar | main | thread | members)
// and, inside main, a COLUMN (dmDock | timeline | ticker | composer). Each
// panel has a size along its domain's axis and two flags:
//
//   locked  -- its size does not change. Highest tier of ownership.
//   pinned  -- its position (order) does not change.
//
// They are independent: a pinned panel can still be resized, a locked panel
// can still be moved. A panel that is neither shares any growth or shrinkage
// PROPORTIONALLY with the other unlocked panels of its domain, because
// together they ARE the movable space. One panel per domain is FLEX -- it
// absorbs whatever is left -- so the domain always adds up.
//
// The default configuration is a sensible preset with the DM dock locked and
// pinned: by default the DM WINS the real-estate argument, because a new user
// is treated as unable to find anything on their own, and Fourier-chan's
// messages must stay visible whatever they click.
//
// The whole state serializes to a NUMBER (a decimal string of a big integer,
// with a checksum), so a layout can be copied out of one client and pasted
// into another, and it is stored server-side as that number.
// ---------------------------------------------------------------------------

export type Domain = 'row' | 'column'
export type PanelId =
  | 'sidebar' | 'main' | 'thread' | 'members'
  | 'dmDock' | 'timeline' | 'ticker' | 'composer'

export interface Panel {
  id: PanelId
  domain: Domain
  // Pixels along the domain's axis. Ignored for the flex panel, which is
  // whatever remains.
  size: number
  min: number
  locked: boolean
  pinned: boolean
  // Position within the domain, ascending.
  order: number
  flex: boolean
  // Shown at all. A hidden panel takes no space and no share.
  open: boolean
}

export interface Layout {
  v: 1
  panels: Record<PanelId, Panel>
}

export const PANEL_IDS: PanelId[] = ['sidebar', 'main', 'thread', 'members', 'dmDock', 'timeline', 'ticker', 'composer']

// The preset. Numbers are the app's current defaults, so adopting the model
// changes nothing on screen until someone edits.
export function defaultLayout(): Layout {
  const p = (id: PanelId, domain: Domain, size: number, min: number, order: number, extra: Partial<Panel> = {}): Panel => ({
    id, domain, size, min, order, locked: false, pinned: false, flex: false, open: true, ...extra,
  })
  return {
    v: 1,
    panels: {
      sidebar:  p('sidebar',  'row', 260, 160, 0),
      main:     p('main',     'row', 0,   320, 1, { flex: true, locked: false }),
      thread:   p('thread',   'row', 380, 240, 2, { open: false }),
      members:  p('members',  'row', 220, 140, 3),
      // The winner. Locked and pinned by default; closed until a DM asks.
      dmDock:   p('dmDock',   'column', 260, 120, 0, { locked: true, pinned: true, open: false }),
      timeline: p('timeline', 'column', 0,   160, 1, { flex: true }),
      ticker:   p('ticker',   'column', 28,  0,   2, { locked: true }),
      composer: p('composer', 'column', 96,  56,  3),
    },
  }
}

export function panelsIn(layout: Layout, domain: Domain): Panel[] {
  return PANEL_IDS.map((id) => layout.panels[id])
    .filter((p) => p.domain === domain && p.open)
    .sort((a, b) => a.order - b.order)
}

function clone(layout: Layout): Layout {
  const panels = {} as Record<PanelId, Panel>
  for (const id of PANEL_IDS) panels[id] = { ...layout.panels[id] }
  return { v: 1, panels }
}

// Resize one panel by `delta` pixels. The change is paid for by the OTHER
// unlocked, non-flex panels of the same domain, proportionally to their
// current sizes; the flex panel absorbs any remainder. Nothing goes below its
// minimum; when nothing can pay, the delta is clamped to what can. Locked
// panels never move a pixel, including the one being dragged.
export function resize(layout: Layout, id: PanelId, delta: number): Layout {
  const target = layout.panels[id]
  if (!target.open || target.locked || target.flex || delta === 0) return layout
  const next = clone(layout)
  const t = next.panels[id]
  const wanted = Math.max(t.min, t.size + delta)
  let applied = wanted - t.size
  if (applied === 0) return layout

  const partners = panelsIn(next, t.domain).filter((p) => p.id !== id && !p.locked && !p.flex)
  const flex = panelsIn(next, t.domain).find((p) => p.flex && !p.locked)
  // Room the partners can give up (growth) or take on (shrink; unbounded).
  const partnerRoom = applied > 0 ? partners.reduce((s, p) => s + (p.size - p.min), 0) : Infinity
  const flexRoom = flex ? (applied > 0 ? Infinity : Infinity) : 0
  const capacity = partnerRoom + flexRoom
  if (applied > capacity) applied = capacity
  if (applied <= 0 && delta > 0) return layout

  t.size += applied
  // Partners share proportionally; the flex panel takes the rest implicitly.
  const total = partners.reduce((s, p) => s + p.size, 0)
  if (partners.length > 0 && total > 0 && !flex) {
    let remaining = applied
    for (const p of partners) {
      const share = Math.round((p.size / total) * applied)
      const give = Math.min(share, p.size - p.min)
      p.size -= give
      remaining -= give
    }
    // Rounding leftovers go to the largest partner that can still pay.
    if (remaining !== 0) {
      const biggest = [...partners].sort((a, b) => b.size - a.size).find((p) => p.size - p.min >= remaining)
      if (biggest) biggest.size -= remaining
    }
  }
  return next
}

export function setFlag(layout: Layout, id: PanelId, flag: 'locked' | 'pinned' | 'open', value: boolean): Layout {
  if (layout.panels[id][flag] === value) return layout
  const next = clone(layout)
  next.panels[id][flag] = value
  return next
}

// Move a panel to a new position within its domain. A pinned panel does not
// move, and no panel may be placed across a pinned one -- the pin holds its
// place in the sequence, not just its own row.
export function move(layout: Layout, id: PanelId, toIndex: number): Layout {
  const t = layout.panels[id]
  if (t.pinned) return layout
  const seq = panelsIn(layout, t.domain)
  const from = seq.findIndex((p) => p.id === id)
  const to = Math.max(0, Math.min(seq.length - 1, toIndex))
  if (from < 0 || from === to) return layout
  const lo = Math.min(from, to), hi = Math.max(from, to)
  if (seq.slice(lo, hi + 1).some((p) => p.pinned && p.id !== id)) return layout
  const reordered = [...seq]
  reordered.splice(from, 1)
  reordered.splice(to, 0, t)
  const next = clone(layout)
  reordered.forEach((p, i) => { next.panels[p.id].order = i })
  return next
}

// --- the number ------------------------------------------------------------
//
// Per panel: order (3 bits) | flags open,pinned,locked (3 bits) | size (12
// bits, px up to 4095). Eight panels, in PANEL_IDS order, prefixed by the
// version and suffixed by a checksum byte. Read as one big integer and shown
// in base 10: about 45 digits, which pastes.

const SIZE_BITS = 12n, FLAG_BITS = 3n, ORDER_BITS = 3n
const PANEL_BITS = SIZE_BITS + FLAG_BITS + ORDER_BITS

function checksum(x: bigint): bigint {
  let s = 0n
  let v = x
  while (v > 0n) { s = (s + (v & 0xffn)) & 0xffn; v >>= 8n }
  return s
}

export function serialize(layout: Layout): string {
  let acc = BigInt(layout.v)
  for (const id of PANEL_IDS) {
    const p = layout.panels[id]
    const size = BigInt(Math.max(0, Math.min(4095, Math.round(p.size))))
    const flags = (p.open ? 4n : 0n) | (p.pinned ? 2n : 0n) | (p.locked ? 1n : 0n)
    const order = BigInt(Math.max(0, Math.min(7, p.order)))
    acc = (acc << PANEL_BITS) | (order << (SIZE_BITS + FLAG_BITS)) | (flags << SIZE_BITS) | size
  }
  acc = (acc << 8n) | checksum(acc)
  return acc.toString(10)
}

// Null when the number is not a layout: wrong shape, bad checksum, unknown
// version. Never a partial layout -- an import either lands whole or not.
export function deserialize(code: string): Layout | null {
  if (!/^\d{1,80}$/.test(code.trim())) return null
  let acc: bigint
  try { acc = BigInt(code.trim()) } catch { return null }
  const sum = acc & 0xffn
  acc >>= 8n
  if (checksum(acc) !== sum) return null
  const base = defaultLayout()
  const ids = [...PANEL_IDS].reverse()
  for (const id of ids) {
    const chunk = acc & ((1n << PANEL_BITS) - 1n)
    acc >>= PANEL_BITS
    const size = Number(chunk & ((1n << SIZE_BITS) - 1n))
    const flags = Number((chunk >> SIZE_BITS) & 7n)
    const order = Number((chunk >> (SIZE_BITS + FLAG_BITS)) & 7n)
    const p = base.panels[id]
    // The flex panel's stored size is nominal (it is whatever remains), so it
    // is kept verbatim: clamping it to a minimum changed the number on the
    // way back in, and a layout must be its own number.
    p.size = p.flex ? size : Math.max(p.min, size)
    p.locked = !!(flags & 1)
    p.pinned = !!(flags & 2)
    p.open = !!(flags & 4)
    p.order = order
  }
  if (acc !== 1n) return null // version
  return base
}
