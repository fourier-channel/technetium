import type { CSSProperties } from 'react'

// ---------------------------------------------------------------------------
// uitransform -- a PORTABLE module for isolating and manipulating a UI element
// in a host environment. This is the seed of the (currently unnamed) library
// that fourier-transform will consume, so it holds NO Technetium/Matrix
// specifics: just a scale-free transform model, its CSS projection, and a
// canonical-JSON-safe wire codec. Everything a host might want to restyle is a
// value in `config.ts`, never hardcoded here.
//
// The transform is deliberately resolution-independent (cf. roompos D-dm01):
// translate is the element CENTER as a normalized [0,1] fraction of the host
// rect, scale is a width multiplier (1 == full host width). So one transform
// renders identically at any surface size -- one truth, many projections.
// ---------------------------------------------------------------------------

export interface Transform {
  tx: number // center X, normalized [0,1] of the host rect
  ty: number // center Y, normalized [0,1]
  scale: number // width multiplier; 1 == full host width
  // Display aspect ratio (width/height, in PIXELS -- container-independent, so a
  // free/non-uniform resize renders identically at any surface size; CD-5). 0
  // means "use the element's natural aspect" (height auto).
  ar: number
  rotation: number // degrees, clockwise
  flipH: boolean // mirror across the vertical axis
  flipV: boolean // mirror across the horizontal axis
}

export const IDENTITY_TRANSFORM: Transform = {
  tx: 0.5,
  ty: 0.5,
  scale: 1,
  ar: 0,
  rotation: 0,
  flipH: false,
  flipV: false,
}

// Bounds a host may want to tune; kept here (not config) because they guard the
// math itself. Scale is generous so a user can zoom a small image right up.
export const SCALE_MIN = 0.05
export const SCALE_MAX = 8

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

export function clampTransform(t: Transform): Transform {
  return {
    tx: clamp(t.tx, 0, 1),
    ty: clamp(t.ty, 0, 1),
    scale: clamp(t.scale, SCALE_MIN, SCALE_MAX),
    // 0 == natural; otherwise a sane positive ratio.
    ar: t.ar > 0 ? clamp(t.ar, 0.05, 20) : 0,
    // Normalize rotation into [0,360).
    rotation: ((t.rotation % 360) + 360) % 360,
    flipH: t.flipH,
    flipV: t.flipV,
  }
}

// Project a transform onto absolute CSS for an <img>/element whose intrinsic
// aspect ratio is preserved (width drives, height auto).
export function transformToStyle(t: Transform): CSSProperties {
  const style: CSSProperties = {
    position: 'absolute',
    left: `${t.tx * 100}%`,
    top: `${t.ty * 100}%`,
    width: `${t.scale * 100}%`,
    height: 'auto',
    transform:
      `translate(-50%, -50%) rotate(${t.rotation}deg) ` +
      `scale(${t.flipH ? -1 : 1}, ${t.flipV ? -1 : 1})`,
    transformOrigin: 'center center',
  }
  // A non-zero display aspect drives height off width, container-independently.
  if (t.ar > 0) style.aspectRatio = String(t.ar)
  return style
}

// --- wire codec: canonical JSON forbids floats, so scale the fractionals to
// integers (cf. G-bf04). Booleans are fine as-is. --------------------------
const TX_SCALE = 10000 // permyriad
const S_SCALE = 1000 // milli

export interface TransformWire {
  tx: number
  ty: number
  scale: number
  ar: number
  rot: number
  flip_h: boolean
  flip_v: boolean
}

export function encodeTransform(t: Transform): TransformWire {
  const c = clampTransform(t)
  return {
    tx: Math.round(c.tx * TX_SCALE),
    ty: Math.round(c.ty * TX_SCALE),
    scale: Math.round(c.scale * S_SCALE),
    ar: Math.round(c.ar * S_SCALE),
    rot: Math.round(c.rotation),
    flip_h: c.flipH,
    flip_v: c.flipV,
  }
}

export function decodeTransform(c: Record<string, unknown>): Transform {
  const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d)
  return clampTransform({
    tx: num(c.tx, 5000) / TX_SCALE,
    ty: num(c.ty, 5000) / TX_SCALE,
    scale: num(c.scale, S_SCALE) / S_SCALE,
    ar: num(c.ar, 0) / S_SCALE,
    rotation: num(c.rot, 0),
    flipH: c.flip_h === true,
    flipV: c.flip_v === true,
  })
}

// --- pure editing ops (used by both interact mode and the transform editor) --
export function nudge(t: Transform, dx: number, dy: number): Transform {
  return clampTransform({ ...t, tx: t.tx + dx, ty: t.ty + dy })
}

export function scaleBy(t: Transform, factor: number): Transform {
  return clampTransform({ ...t, scale: t.scale * factor })
}

export function mirrorH(t: Transform): Transform {
  return { ...t, flipH: !t.flipH }
}

export function mirrorV(t: Transform): Transform {
  return { ...t, flipV: !t.flipV }
}

// Snap the display aspect back to the element's natural ratio (the "4:3->4:3"
// maintain-aspect action). ar 0 == natural.
export function snapAspect(t: Transform): Transform {
  return { ...t, ar: 0 }
}

// --- box geometry (pixels within the host rect), for handle-drag resize -------
// Rotation is assumed 0 for handle math (no rotate control ships in v1); a
// non-zero rotation still renders, but resizing it is a documented v1 gap.

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export const HANDLE_IDS: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

// naturalAspect == element intrinsic width/height. W,H == host rect in px.
export function transformToBox(t: Transform, W: number, H: number, naturalAspect: number): Box {
  const width = t.scale * W
  const ea = t.ar > 0 ? t.ar : naturalAspect
  const height = ea > 0 ? width / ea : width
  return { left: t.tx * W - width / 2, top: t.ty * H - height / 2, width, height }
}

export function boxToTransform(box: Box, base: Transform, W: number, H: number): Transform {
  const cx = box.left + box.width / 2
  const cy = box.top + box.height / 2
  return clampTransform({
    ...base,
    tx: cx / W,
    ty: cy / H,
    scale: box.width / W,
    ar: box.height > 0 ? box.width / box.height : base.ar,
  })
}

const MIN_PX = 24

// Resize a box by dragging `handle` to (px,py) in host-rect pixels. The
// opposite edge/corner stays anchored. With `lock`, the box keeps `naturalAspect`
// (width/height): corner + E/W drags derive height from width, N/S derive width
// from height.
export function resizeBox(
  box: Box,
  handle: HandleId,
  px: number,
  py: number,
  lock: boolean,
  naturalAspect: number,
): Box {
  let left = box.left
  let top = box.top
  let right = box.left + box.width
  let bottom = box.top + box.height

  const hasE = handle.includes('e')
  const hasW = handle.includes('w')
  const hasS = handle.includes('s')
  const hasN = handle.includes('n')

  if (hasE) right = Math.max(px, left + MIN_PX)
  if (hasW) left = Math.min(px, right - MIN_PX)
  if (hasS) bottom = Math.max(py, top + MIN_PX)
  if (hasN) top = Math.min(py, bottom - MIN_PX)

  let width = right - left
  let height = bottom - top

  if (lock && naturalAspect > 0) {
    const drivesWidth = hasE || hasW
    const drivesHeight = hasS || hasN
    if (drivesWidth && !drivesHeight) {
      // E/W edge: height follows width, keep vertical center.
      const cy = top + height / 2
      height = width / naturalAspect
      top = cy - height / 2
    } else if (drivesHeight && !drivesWidth) {
      // N/S edge: width follows height, keep horizontal center.
      const cx = left + width / 2
      width = height * naturalAspect
      left = cx - width / 2
    } else {
      // Corner: fit natural ratio to the larger requested dimension, anchored on
      // the fixed corner.
      const anchorX = hasW ? right : left
      const anchorY = hasN ? bottom : top
      if (width / naturalAspect >= height) height = width / naturalAspect
      else width = height * naturalAspect
      left = hasW ? anchorX - width : anchorX
      top = hasN ? anchorY - height : anchorY
    }
  }

  return { left, top, width, height }
}
