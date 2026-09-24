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

// ---------------------------------------------------------------------------
// The mouse wheel: one notch is one card.
//
// Operator, 2026-09-24: "Threads travel too quickly--two positions per single
// mousewheel tick, it should be just one." The old handler added every delta
// to a running total and spent it 40px at a time in a loop, so one 100px
// Chrome notch was 2 steps, a 120px notch 3, and a remainder that was never
// cleared made each notch depend on the ones before it (2, 3, 2, 3...).
//
// The rules, in order:
//  - line or page units are a detent by definition: one step;
//  - the first event of a gesture (after a pause, or a reversal) steps at
//    once, whatever its size -- a slow spin and a 4px notch both count;
//  - within a gesture, an event of a notch's size is one step, never more;
//  - anything smaller (hi-res wheels, trackpads) adds up to about one Chrome
//    notch before it steps, and the total is spent, not carried.
//
// Time comes in with the event (its timeStamp), so this stays pure.
export const WHEEL = {
  LINE_PX: 16,
  PAGE_PX: 400,
  MIN_PX: 2,
  NOTCH_PX: 30,
  STEP_PX: 100,
  GAP_MS: 200,
} as const

export interface WheelState {
  acc: number
  lastT: number
  lastDir: -1 | 0 | 1
}

export const WHEEL_IDLE: WheelState = { acc: 0, lastT: -Infinity, lastDir: 0 }

export interface WheelInput {
  dx: number
  dy: number
  /** WheelEvent.deltaMode: 0 pixels, 1 lines, 2 pages. */
  mode: number
  /** WheelEvent.timeStamp, in ms. */
  t: number
}

export function wheelStep(s: WheelState, ev: WheelInput): { state: WheelState; step: -1 | 0 | 1 } {
  const raw = Math.abs(ev.dx) > Math.abs(ev.dy) ? ev.dx : ev.dy
  const d = raw * (ev.mode === 1 ? WHEEL.LINE_PX : ev.mode === 2 ? WHEEL.PAGE_PX : 1)
  if (!Number.isFinite(d) || !Number.isFinite(ev.t) || Math.abs(d) < WHEEL.MIN_PX) {
    return { state: s, step: 0 }
  }
  const dir: -1 | 1 = d > 0 ? 1 : -1
  const fresh = ev.t - s.lastT > WHEEL.GAP_MS || dir !== s.lastDir
  if (ev.mode !== 0 || fresh || Math.abs(d) >= WHEEL.NOTCH_PX) {
    return { state: { acc: 0, lastT: ev.t, lastDir: dir }, step: dir }
  }
  const acc = s.acc + d
  if (Math.abs(acc) >= WHEEL.STEP_PX) {
    return { state: { acc: 0, lastT: ev.t, lastDir: dir }, step: dir }
  }
  return { state: { acc, lastT: ev.t, lastDir: dir }, step: 0 }
}

// How far a card is from the focus, for styling. Capped, because a card six
// places away and one sixty places away should look the same -- both are
// simply "not near".
export const MAX_VISUAL_DISTANCE = 3

export function visualDistance(index: number, focus: number): number {
  return Math.min(MAX_VISUAL_DISTANCE, Math.abs(index - focus))
}
