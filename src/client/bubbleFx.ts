import { seedHash } from './memberEvents'
import type { BubbleTone } from './bubbleTone'

// ---------------------------------------------------------------------------
// The bubble animators (ui-depth-v1 U5).
//
// Every one of the three plays the SAME opening: the ordinary pill, in that
// tone's own colours. What each does next is the whole of the feature:
//
//   yelling      pops from the pill into the jagged burst, keeping the pill's
//                border colour and fill -- the old one threw both away, which
//                is most of why it read as cheap.
//   thinking     morphs from the pill into cloudy bubbles.
//   questioning  stays a pill, and question marks float up and over it, fading
//                in as they spawn and out as they go.
//
// This module is the DATA: how long each stage lasts, and where a given row's
// question marks go. The shapes are CSS and the sequencing is a hook; neither
// can be loaded by the check harness, and both would be much harder to reason
// about with the numbers buried in them.
//
// SEEDED, not random. A row's marks are a function of its event id, so the same
// message always looks the same -- the same reasoning as the arrival animations
// in memberEvents.ts, where a fresh random pick per replay read as a rendering
// glitch rather than as character.
//
// Pure, so the harness can load it (O-tp9).
// ---------------------------------------------------------------------------

// How long the pill is just a pill before it becomes anything else. Long enough
// to be seen as a pill -- the ask was that the default renders FIRST -- and
// short enough not to read as a stall.
export const PILL_MS = 230

// The pop / morph itself. Past this the bubble holds its final shape forever,
// so the animation is removed and static rules take over; the two agree, or
// the bubble would jump at the handover.
export const MORPH_MS = 520

// The question marks are a longer, quieter business: they drift the height of
// the bubble and a bit more, and the last one spawns well after the first.
export const QMARK_MS = 1500
export const QMARK_STAGGER_MS = 190

// How many float up. Enough to read as "several" (the operator's word) without
// becoming weather.
export const QMARK_COUNT = 4

export interface QMark {
  // Where it spawns, as a percentage across the bubble's width.
  xPct: number
  // How far it drifts sideways on the way up, in px. Signed.
  driftPx: number
  // How far it rises, in px.
  risePx: number
  // How much it turns on the way, in degrees. Signed.
  spinDeg: number
  // Its size, in px.
  sizePx: number
  delayMs: number
}

// The whole flight plan for one row's marks. Deterministic in `seed`.
export function qmarks(seed: string, count = QMARK_COUNT): QMark[] {
  const out: QMark[] = []
  for (let i = 0; i < count; i++) {
    // A different salt per axis, so the four numbers do not move in lockstep
    // and produce four marks on one diagonal.
    const h = (salt: number) => seedHash(`${seed}:${i}:${salt}`)
    const span = (salt: number, lo: number, hi: number) => lo + (h(salt) % (hi - lo + 1))
    out.push({
      // Kept off the very edges: a mark spawning at 0% straddles the bubble's
      // border, which reads as a rendering fault rather than as a question.
      xPct: span(1, 14, 84),
      driftPx: span(2, 0, 26) - 13,
      risePx: span(3, 30, 52),
      spinDeg: span(4, 0, 44) - 22,
      sizePx: span(5, 11, 17),
      delayMs: i * QMARK_STAGGER_MS,
    })
  }
  return out
}

// How long a tone's whole performance lasts, from the moment it starts.
// The caller unmounts on a TIMER built from this and never on animationend
// (G-tc06 / G-04f01d): an animation that is a no-op never fires its end event,
// and anything waiting for one waits forever.
export function fxDurationMs(tone: BubbleTone): number {
  if (tone === 'questioning') return QMARK_MS + QMARK_STAGGER_MS * (QMARK_COUNT - 1)
  if (tone === 'standard') return 0
  return MORPH_MS
}

// Does this tone have anything to play at all? 'standard' is the plain pill and
// stays one -- if every message animated, none of them would mean anything.
export function toneAnimates(tone: BubbleTone): boolean {
  return tone !== 'standard'
}
