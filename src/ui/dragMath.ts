// ---------------------------------------------------------------------------
// The arithmetic of drag-to-reorder, with no DOM and no React, so the check
// suite can prove it over its inputs (checks/roomDrag.check.ts). threadDrag.ts
// is the gesture; this is what the gesture decides. The room list's keyboard
// reorder (tc.36) decides through here too, so a key press and a drag that
// mean the same move cannot produce two different orders (D-tc01).
// ---------------------------------------------------------------------------

/** How close to an edge, in px, the pointer must be before the list scrolls. */
export const EDGE_PX = 44
/** The fastest scroll, in px per frame, reached with the pointer at the edge. */
export const MAX_SCROLL_SPEED = 14

/** The one element a drag scrolls: what the browser reports about it. */
export interface Scroller {
  scrollTop: number
  readonly scrollHeight: number
  readonly clientHeight: number
  getBoundingClientRect(): { top: number; bottom: number }
}

/**
 * Scroll the scroller one frame toward the edge the pointer is near, faster
 * the closer it is. Returns how far it actually moved (0 when the pointer is
 * clear of both edges or the scroller is already at that end).
 *
 * The scroller is the element that scrolls -- the sidebar's own scroll box --
 * and NOT necessarily the container the cards are measured in. The room list
 * measures each space's children in their own group (so a room cannot land in
 * another space's slot), and a group never scrolls: driving the group wrote to
 * a scrollTop that stayed 0, which is how edge-autoscroll was lost.
 */
export function autoscrollStep(scroller: Scroller, pointerY: number): number {
  const rect = scroller.getBoundingClientRect()
  let d = 0
  if (pointerY < rect.top + EDGE_PX) {
    d = -MAX_SCROLL_SPEED * Math.min(1, (rect.top + EDGE_PX - pointerY) / EDGE_PX)
  } else if (pointerY > rect.bottom - EDGE_PX) {
    d = MAX_SCROLL_SPEED * Math.min(1, (pointerY - (rect.bottom - EDGE_PX)) / EDGE_PX)
  }
  if (d === 0) return 0
  const before = scroller.scrollTop
  const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  scroller.scrollTop = Math.max(0, Math.min(maxScroll, before + d))
  return scroller.scrollTop - before
}

/**
 * The order a drop produces: every other card above or below the dragged
 * card's centre, by its own centre, and the dragged card between them.
 */
export function dropOrder(cards: ReadonlyArray<{ id: string; center: number }>, dragIndex: number, draggedCenter: number): string[] {
  const above: string[] = []
  const below: string[] = []
  for (let j = 0; j < cards.length; j++) {
    if (j === dragIndex) continue
    if (cards[j].center > draggedCenter) below.push(cards[j].id)
    else above.push(cards[j].id)
  }
  return [...above, cards[dragIndex].id, ...below]
}

/**
 * Move one id by `delta` places (-1 up, +1 down) among its siblings. Null when
 * the id is not among them or the move would leave the list: the caller says
 * so rather than writing an unchanged order.
 */
export function moveBy(ids: readonly string[], id: string, delta: number): string[] | null {
  const from = ids.indexOf(id)
  if (from < 0) return null
  const to = from + delta
  if (delta === 0 || to < 0 || to >= ids.length) return null
  const out = ids.filter((x) => x !== id)
  out.splice(to, 0, id)
  return out
}
