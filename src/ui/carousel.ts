// ---------------------------------------------------------------------------
// Carousel geometry: where the track sits so that the focused card is centred.
//
// The premise, in the operator's words, is that the results come to the reader
// rather than the reader going to the results. So the track moves and the
// reading position does not -- which makes "where is the focus" the only state,
// and this the only arithmetic.
//
// Pure, so the harness can check it without a DOM (O-tp9).
// ---------------------------------------------------------------------------

export interface TrackMetrics {
  cardWidth: number
  gap: number
  viewportWidth: number
  count: number
}

/** The x of a card's centre within the track, measured from the track's left. */
export function cardCentre(index: number, cardWidth: number, gap: number): number {
  return index * (cardWidth + gap) + cardWidth / 2
}

// How far to slide the track so `focus` sits under the middle of the viewport.
// Negative moves the track left, which is the usual direction.
//
// Deliberately NOT clamped to the ends. A carousel that refuses to centre its
// first and last cards leaves them permanently off-centre while every other
// card is centred, which reads as the control being broken at the edges. The
// empty space beside them is the honest picture of being at the end.
export function trackOffset(focus: number, m: TrackMetrics): number {
  if (m.count <= 0) return 0
  const clamped = Math.max(0, Math.min(m.count - 1, focus))
  return m.viewportWidth / 2 - cardCentre(clamped, m.cardWidth, m.gap)
}

// Move the focus, stopping at the ends rather than wrapping. Wrapping in a list
// sorted by recency would jump from the newest thread to the oldest on one
// keypress, which is never what the reader meant.
export function stepFocus(current: number, delta: number, count: number): number {
  if (count <= 0) return 0
  return Math.max(0, Math.min(count - 1, current + delta))
}

// How far a card is from the focus, for styling. Capped, because a card six
// places away and one sixty places away should look the same -- both are
// simply "not near".
export const MAX_VISUAL_DISTANCE = 3

export function visualDistance(index: number, focus: number): number {
  return Math.min(MAX_VISUAL_DISTANCE, Math.abs(index - focus))
}
