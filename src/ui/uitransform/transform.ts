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
  rotation: number // degrees, clockwise
  flipH: boolean // mirror across the vertical axis
  flipV: boolean // mirror across the horizontal axis
}

export const IDENTITY_TRANSFORM: Transform = {
  tx: 0.5,
  ty: 0.5,
  scale: 1,
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
    // Normalize rotation into [0,360).
    rotation: ((t.rotation % 360) + 360) % 360,
    flipH: t.flipH,
    flipV: t.flipV,
  }
}

// Project a transform onto absolute CSS for an <img>/element whose intrinsic
// aspect ratio is preserved (width drives, height auto).
export function transformToStyle(t: Transform): CSSProperties {
  return {
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
}

// --- wire codec: canonical JSON forbids floats, so scale the fractionals to
// integers (cf. G-bf04). Booleans are fine as-is. --------------------------
const TX_SCALE = 10000 // permyriad
const S_SCALE = 1000 // milli

export interface TransformWire {
  tx: number
  ty: number
  scale: number
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
