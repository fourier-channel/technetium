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
// Chrome notch was 2 steps, a 120px notch 3.
//
// A NOTCH IS KNOWN BY ITS TIMING, NOT ITS SIZE. Notch sizes run from 4px (a
// slow tick of an ordinary mouse in Chrome on macOS) to 400px, so no size
// threshold separates "one notch" from "a piece of a stream" -- the first fix
// tried 30px and a steady roll of small notches moved one card and stalled.
// What separates them is time: a notch arrives ON ITS OWN, a hi-res wheel's
// detent or a trackpad's swipe arrives as a BURST of events a few ms apart.
//
// The rules:
//  - an event that starts a burst (more than BURST_GAP_MS after the last one,
//    or in line/page units, which are a detent by definition) steps ONCE,
//    whatever its size;
//  - the rest of a burst is a stream: it steps again only after about a
//    card's width of scroll (STREAM_PX) AND at least STREAM_STEP_MS since the
//    last step, so a trackpad fling moves a handful of cards, not the list;
//  - a reversal inside a stream counts only past REVERSE_PX, so a resting
//    finger's jitter moves nothing.
//
// Time comes in with the event (its timeStamp), so this stays pure.
export const WHEEL = {
  LINE_PX: 16,
  PAGE_PX: 400,
  MIN_PX: 3,
  BURST_GAP_MS: 25,
  STREAM_PX: 360,
  STREAM_STEP_MS: 180,
  REVERSE_PX: 10,
} as const

export interface WheelState {
  /** When the last counted event arrived. */
  lastT: number
  /** When the last step was taken. */
  stepT: number
  /** Direction of the current burst. */
  dir: -1 | 0 | 1
  /** Distance scrolled in the current burst since its last step. */
  acc: number
}

export const WHEEL_IDLE: WheelState = { lastT: -Infinity, stepT: -Infinity, dir: 0, acc: 0 }

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
  const inBurst = ev.mode === 0 && ev.t - s.lastT <= WHEEL.BURST_GAP_MS
  if (inBurst && dir !== s.dir) {
    // A reversal mid-stream: jitter unless it is decisive.
    if (Math.abs(d) < WHEEL.REVERSE_PX) return { state: { ...s, lastT: ev.t }, step: 0 }
  } else if (inBurst) {
    const acc = s.acc + Math.abs(d)
    if (acc >= WHEEL.STREAM_PX && ev.t - s.stepT >= WHEEL.STREAM_STEP_MS) {
      return { state: { lastT: ev.t, stepT: ev.t, dir, acc: 0 }, step: dir }
    }
    return { state: { ...s, lastT: ev.t, acc }, step: 0 }
  }
  // A notch on its own, or the start of a new burst: one card.
  return { state: { lastT: ev.t, stepT: ev.t, dir, acc: 0 }, step: dir }
}

// How far a card is from the focus, for styling. Capped, because a card six
// places away and one sixty places away should look the same -- both are
// simply "not near".
export const MAX_VISUAL_DISTANCE = 3

export function visualDistance(index: number, focus: number): number {
  return Math.min(MAX_VISUAL_DISTANCE, Math.abs(index - focus))
}
