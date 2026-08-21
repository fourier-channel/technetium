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

// Whether a play has the anchors its choreography needs. O-in1 is unchanged --
// a play that cannot be staged is dropped, never clamped to an edge -- this
// only decides which anchors O-in1 is asking about.
export function anchorsSatisfied(
  requires: 'actor' | 'target' | 'both',
  from: Point | null,
  to: Point | null,
): boolean {
  if (requires === 'actor') return !!from
  if (requires === 'target') return !!to
  return !!from && !!to
}

// --- the arc ---------------------------------------------------------------
//
// A slap that travels in a straight line reads as a glyph sliding across the
// screen. Bowing it out to one side makes it read as thrown.
//
// Which side is decided by HASHING THE PLAY ID rather than by Math.random(),
// for two reasons. The id is on the wire, so every client that renders the same
// slap bows it the same way -- a random side would have the sender and the
// receiver watching visibly different events. And a random value read during
// render would change on every re-render, which the React Compiler rules forbid
// anyway (G-tc01).
export function arcSign(key: string): -1 | 1 {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 2147483647
  return h % 2 === 0 ? -1 : 1
}

// How far the arc bows out, as a fraction of the flight distance, capped so a
// slap across a wide room does not leave the screen on its way there.
const ARC_FRACTION = 0.3
const ARC_MAX_PX = 120
const ARC_MIN_PX = 24

// The control point the glyph passes through on its way out: the midpoint,
// pushed perpendicular to the flight path. `sign` picks the side.
//
// Perpendicular, not "up": two people side by side in a wide room are a mostly
// horizontal flight, and bowing that one vertically is right, while a mostly
// vertical flight down a message list must bow sideways or the arc is invisible
// behind the travel. Rotating the offset with the path handles both without a
// special case.
export function arcMidpoint(from: Point, to: Point, sign: -1 | 1): Point {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
  // Degenerate: slapping somebody standing exactly where you are. No direction
  // to be perpendicular to, so there is no arc to draw.
  if (len === 0) return mid
  const bow = Math.min(Math.max(len * ARC_FRACTION, ARC_MIN_PX), ARC_MAX_PX) * sign
  return { x: mid.x + (-dy / len) * bow, y: mid.y + (dx / len) * bow }
}

// Where an 'approach' play's avatar starts: beside the target, on the side the
// hash chose, so it moves INTO them rather than out of them.
const APPROACH_OFFSET_PX = 72

export function approachStart(target: Point, sign: -1 | 1): Point {
  return { x: target.x + APPROACH_OFFSET_PX * sign, y: target.y }
}

// --- the arm ---------------------------------------------------------------
//
// A sticky hand with no arm is just a hand flying across the room. The arm is
// drawn as ONE bar pinned at the actor, rotated to point at wherever the hand
// currently is and scaled to reach it -- so it does not follow the hand's arc,
// it SWINGS as the hand swings around, which is what a rubber arm actually does.
//
// The bar is 1px wide at rest, so `length` is directly its scaleX factor.

export interface ArmSegment {
  // Degrees, because that is what CSS rotate() wants.
  angle: number
  length: number
}

export function armSegment(from: Point, to: Point): ArmSegment {
  const dx = to.x - from.x
  const dy = to.y - from.y
  return {
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    length: Math.hypot(dx, dy),
  }
}

// The waypoints the arm is sampled at. These MUST correspond to the percentages
// in the ixTravel keyframes -- the arm is interpolated between the same poses
// the hand is, and a sample taken anywhere else would have the arm pointing
// somewhere the hand is not.
export interface TravelPoses {
  windup: Point
  mid: Point
  impact: Point
  recoil: Point
}

const WINDUP_DX = -8
const WINDUP_DY = 3
const RECOIL_DX = -5

export function travelPoses(from: Point, to: Point, sign: -1 | 1): TravelPoses {
  return {
    windup: { x: from.x + WINDUP_DX, y: from.y + WINDUP_DY },
    mid: arcMidpoint(from, to, sign),
    impact: to,
    recoil: { x: from.x + RECOIL_DX, y: from.y },
  }
}

// --- the splash -------------------------------------------------------------
//
// Who else got wet. Every client works this out from ITS OWN viewport (D-in09):
// the wire carries only who squirted whom, and each screen decides who was
// standing in the way of it. A sender's list of casualties would describe the
// sender's screen, not yours -- and would be forgeable, which is the same
// reasoning that reads the actor from getSender() and never from content.
//
// The perpendicular distance from a point to the SEGMENT, not to the infinite
// line through it: somebody standing well past the target, or well behind the
// shooter, is not in the line of fire however neatly they line up with it.
export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  // Degenerate: shooter and target in the same place. Fall back to distance
  // from the point itself rather than dividing by zero.
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  // Clamped to [0,1] -- that clamp IS the difference between a segment and a
  // line, and dropping it soaks bystanders on the far side of the room.
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

// How close counts as caught in it.
export const SPLASH_RADIUS_PX = 46

export function inSplash(p: Point, a: Point, b: Point): boolean {
  return pointSegmentDistance(p, a, b) <= SPLASH_RADIUS_PX
}

// --- guard ------------------------------------------------------------------

/** How far short of a guarded person a deflected play stops. */
export const GUARD_STANDOFF_PX = 34

// The point `px` before `to`, along the line from `from`. A deflected play
// still plays -- it just does not arrive, which is what being held at arm's
// length looks like. Stopping AT the target and simply not drawing the impact
// would read as a hit that failed to render.
export function stopShort(from: Point, to: Point, px: number): Point {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  // Closer than the stand-off already, or nowhere to back off to: do not
  // overshoot backwards past the sender, which would look like a retreat.
  if (len === 0 || len <= px) return from
  const t = (len - px) / len
  return { x: from.x + dx * t, y: from.y + dy * t }
}
