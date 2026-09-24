// ---------------------------------------------------------------------------
// Where an attached popup goes: the geometry, pure, so the check suite can
// hold it without a DOM (launch-polish L5).
//
// "The 'expose tags' button unfurling to the right, with a true attached
// popup behavior that covers the user list if needed -- don't constrain it to
// its own panel" (operator, 2026-09-24). So the popup's top-left sits ON the
// control that opened it and it grows rightward and downward from there, over
// whatever is beside it. It is clamped only by the WINDOW, never by the panel
// the control lives in: a popup near the right edge slides left just far
// enough to stay whole, one near the bottom slides up, and one taller than the
// window is capped and scrolls.
//
// Mirrors the booru's gallery tag pop (modulation_gallery_tagpop.js), which
// also flips and clamps against the viewport rather than its card.
// ---------------------------------------------------------------------------

export interface AnchorRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface Size {
  w: number
  h: number
}

export interface Placement {
  x: number
  y: number
  /** Cap on the popup's height, so it never runs off the window. */
  maxH: number
}

export const POPUP_MARGIN = 8

export function placeUnfurl(anchor: AnchorRect, size: Size, vp: Size, margin = POPUP_MARGIN): Placement {
  const maxH = Math.max(0, vp.h - 2 * margin)
  const h = Math.min(size.h, maxH)
  // Rightward from the control; slid left only as far as the window demands,
  // and never past the left margin.
  let x = anchor.left
  if (x + size.w > vp.w - margin) x = vp.w - margin - size.w
  x = Math.max(margin, x)
  // Downward from the control; slid up only as far as the window demands.
  let y = anchor.top
  if (y + h > vp.h - margin) y = vp.h - margin - h
  y = Math.max(margin, y)
  return { x: Math.round(x), y: Math.round(y), maxH }
}

/** Is any part of the anchor inside the box it scrolls within? */
export function anchorVisible(anchor: AnchorRect, within: AnchorRect): boolean {
  return anchor.bottom > within.top && anchor.top < within.bottom && anchor.right > within.left && anchor.left < within.right
}
