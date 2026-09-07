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

// True when a face's box can only ever render as a circle: equal sides plus a
// 50% radius. An ellipse is what the operator actually saw, so this is the
// property worth naming.
export function isCircular(box: DmFaceBox): boolean {
  return box.width === box.height && box.borderRadius === '50%'
}
