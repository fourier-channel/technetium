// ---------------------------------------------------------------------------
// Where an interaction anchor sits, in the overlay's coordinate space.
//
// TWO DIFFERENT BOXES, and conflating them is the whole reason this module
// exists as a checkable thing rather than four lines inside a component:
//
//   - VISIBILITY is judged against the SCROLLER's visible band. A pill that has
//     been scrolled out of view is still in the DOM, and a play aimed at it is
//     dropped rather than aimed at the edge of the screen (O-in1).
//   - POSITION is measured from the LAYER's own origin -- never the scroller's.
//
// They were the same expression once, and that was the bug: the layer was
// mounted inside the scroller, where `inset: 0` pins an absolutely positioned
// element to the top of the SCROLLED CONTENT rather than to the visible box.
// The two origins then differ by exactly scrollTop, so every play rendered
// scrollTop pixels above the screen and was clipped away. It only ever looked
// correct in a room scrolled hard to the top.
//
// Pure, and structurally typed rather than taking DOMRect, so the harness can
// pass plain objects (O-tp9: a module under check imports no DOM types).
// ---------------------------------------------------------------------------

export interface RectLike {
  top: number
  bottom: number
  left: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

// The centre of `anchor` relative to `layer`, or null when the anchor is
// outside the scroller's visible band.
export function anchorPoint(
  scroller: RectLike,
  layer: RectLike,
  anchor: RectLike,
): Point | null {
  if (anchor.bottom < scroller.top || anchor.top > scroller.bottom) return null
  return {
    x: anchor.left - layer.left + anchor.width / 2,
    y: anchor.top - layer.top + anchor.height / 2,
  }
}
