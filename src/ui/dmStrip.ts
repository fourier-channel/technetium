import type { CSSProperties } from 'react'

// Geometry for the DM strip's faces.
//
// It lives in its own module because the bug it fixes was invisible in place:
// EpicycleReveal's `size` defaulted to 20 while the RoomIcon inside it was
// passed 30, so a face MEASURED 20px and DREW 30px. The button carrying the
// waiting glow took its box from the measurement, which is why the ring came
// out as an oval, why it sat off-centre, and why faces sat at different heights
// depending on whether the reveal animation happened to be playing. Two numbers
// that had to agree were written eight hundred lines apart and did not.
//
// Everything below is derived from ONE avatar size, and the check asserts the
// properties that made the old version wrong: the face is square, the ring is
// inside the box, and the reveal is the same size as the icon it reveals.

// The drawn avatar.
export const DM_AVATAR = 30
// The ring every face wears, avatar or bare initial alike, so the row reads as
// one set rather than pictures floating next to letters.
export const DM_RING = 1
// The button's border-box. Border-box is what makes the ring sit INSIDE the
// tile, so the tile stays square and the glow stays concentric with it.
export const DM_TILE = DM_AVATAR + DM_RING * 2

export interface DmFaceBox {
  width: number
  height: number
  boxSizing: 'border-box'
  borderRadius: '50%'
  // What both the reveal wrapper and the icon must be given. One value, so
  // they cannot disagree again.
  contentSize: number
}

export function dmFaceBox(): DmFaceBox {
  return {
    width: DM_TILE,
    height: DM_TILE,
    boxSizing: 'border-box',
    borderRadius: '50%',
    contentSize: DM_AVATAR,
  }
}

export interface DmFaceState {
  ping: boolean
  unread: boolean
}

// The face's COMPLETE box, exported as data so it can be measured in a real
// layout engine instead of argued about. The whole class of bug here was a box
// that came out a different shape than its author expected, which is not
// something reading the source reliably tells you.
export function dmFaceStyle(state: DmFaceState): CSSProperties {
  return {
    // Fixed square, border-box: the button IS the face's box, so a 50% radius
    // is a circle and never an ellipse, and no flex sibling can stretch it.
    // Without an explicit size a flex item takes its height from its content,
    // and the content differed per face.
    width: DM_TILE,
    height: DM_TILE,
    boxSizing: 'border-box',
    flex: '0 0 auto',
    alignSelf: 'center',
    display: 'grid',
    placeItems: 'center',
    padding: 0,
    // Every face is ringed, avatar or bare initial alike, so the row reads as
    // one set rather than pictures floating beside letters.
    border: `${DM_RING}px solid rgba(128,128,128,0.45)`,
    background: 'transparent',
    cursor: 'pointer',
    lineHeight: 0,
    borderRadius: '50%',
    // Glow, not a badge: at this size there is no room for a counter, and the
    // ring reads at a glance across a wrapped grid of faces. The static ring is
    // the reduced-motion base; .tc-dm-waiting pulses it.
    boxShadow: state.ping
      ? '0 0 0 2px var(--tc-unread), 0 0 12px 2px rgba(255,150,40,0.75)'
      : state.unread
        ? '0 0 0 2px var(--tc-unread-base), 0 0 9px rgba(255,150,40,0.45)'
        : undefined,
  }
}

// True when a face's box can only ever render as a circle: equal sides plus a
// 50% radius. An ellipse is what the operator actually saw, so this is the
// property worth naming.
export function isCircular(box: DmFaceBox): boolean {
  return box.width === box.height && box.borderRadius === '50%'
}
