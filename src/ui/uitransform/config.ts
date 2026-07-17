// ---------------------------------------------------------------------------
// uitransform config -- the "UI of the UI builder". Every visual value the
// transform chrome draws (the marching-ants selection, the handle markers, the
// button/toggle overlays) reads from THIS object, never a hardcoded literal, so
// a host can restyle the whole manipulation surface by passing a different
// config. Categories the operator called out (dotted-line shift frequency,
// resize-marker size/shape, button/overlay style, toggle look) each map to a
// field group below. This is what fourier-transform will theme.
// ---------------------------------------------------------------------------

export interface MarchingAntsStyle {
  dash: number // px of drawn segment
  gap: number // px of empty segment
  thickness: number // px border thickness
  color: string
  periodMs: number // full dash-shift cycle time; lower == faster "shift frequency"
}

export interface HandleStyle {
  size: number // px marker edge
  shape: 'square' | 'circle'
  fill: string
  stroke: string
  strokeWidth: number
}

export interface OverlayButtonStyle {
  height: number
  paddingX: number
  radius: number
  fontSize: number
  gap: number // gap between buttons in a strip
  bg: string
  fg: string
  border: string
  pressedBg: string // momentary "depress" feedback
  litBg: string // toggle ON
  litFg: string
  dimBg: string // toggle OFF (greyed)
  dimFg: string
}

export interface UiTransformConfig {
  marchingAnts: MarchingAntsStyle
  handle: HandleStyle
  button: OverlayButtonStyle
}

export const defaultUiTransformConfig: UiTransformConfig = {
  marchingAnts: {
    dash: 6,
    gap: 4,
    thickness: 1.5,
    color: '#ffffff',
    periodMs: 600,
  },
  handle: {
    size: 10,
    shape: 'square',
    fill: '#ffffff',
    stroke: '#3390ff',
    strokeWidth: 1.5,
  },
  button: {
    height: 30,
    paddingX: 10,
    radius: 8,
    fontSize: 12,
    gap: 6,
    bg: 'rgba(20,22,26,0.92)',
    fg: '#f4f5f7',
    border: 'rgba(255,255,255,0.22)',
    pressedBg: 'rgba(90,96,110,0.95)',
    litBg: '#3390ff',
    litFg: '#ffffff',
    dimBg: 'rgba(20,22,26,0.92)',
    dimFg: 'rgba(200,205,215,0.55)',
  },
}
