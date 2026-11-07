// ---------------------------------------------------------------------------
// The thinking bubble's cloud, as geometry (INTERFACE_OPTIONS IO2, IO4, IO5).
//
// The operator picked "Cumulus" from a comparison page: an uneven scalloped
// outline in a big-small rhythm, drawn to the bubble's MEASURED size. The old
// cloud was a tiled CSS background, which could only repeat one bump and
// rendered as a cog where it met itself. A path drawn to the box can do both
// ends of a rhythm and close cleanly.
//
// Coordinates are the bubble's BORDER BOX: (0,0) is its top-left corner and
// (w,h) its bottom-right. The caller places the drawing there.
//
// Pure, so the check suite can prove the two things a drawing must never do:
// reach past the clearance its row keeps (IO4: two bubbles never overlap), and
// trail off anywhere but toward the speaker's avatar (IO5).
// ---------------------------------------------------------------------------

export interface CloudStyle {
  /** How far inside the box the scallops' feet stand. */
  inset: number
  /** The average distance between two feet. */
  chord: number
  /** Arc radius as a fraction of each chord: 0.5 is a half circle, more is flatter. */
  k: number
  /** The rhythm the chords repeat, as multiples of `chord`. */
  pattern: readonly number[]
}

export const CUMULUS: CloudStyle = { inset: 3, chord: 15, k: 0.55, pattern: [1.35, 0.75, 1.1, 0.8, 1.25, 0.7] }

// The two circles of the thought's tail, in the 12px gap between the bubble
// and the avatar, stepping down toward the avatar's centre. [cx, cy, r].
export const CLOUD_TRAIL: readonly (readonly [number, number, number])[] = [
  [-6.5, 15, 2.6],
  [-10.3, 17, 1.5],
]

// The room a drawing gets beyond the box (the SVG's margin), which must be
// more than anything ever drawn reaches; the check holds it to that.
export const DRAW_MARGIN = 24

const f1 = (n: number) => Math.round(n * 10) / 10

interface Walk {
  L: number
  at: (s: number) => [number, number]
}

/** A rounded rectangle, walked clockwise in screen coordinates. */
export function roundedRect(x: number, y: number, w: number, h: number, radius: number): Walk {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2))
  type Seg = { len: number; at: (t: number) => [number, number] }
  const line = (x1: number, y1: number, x2: number, y2: number): Seg => ({
    len: Math.hypot(x2 - x1, y2 - y1),
    at: (t) => [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t],
  })
  const arc = (cx: number, cy: number, a0: number): Seg => ({
    len: (Math.PI * r) / 2,
    at: (t) => {
      const a = a0 + (t * Math.PI) / 2
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
    },
  })
  const segs: Seg[] = [
    line(x + r, y, x + w - r, y), arc(x + w - r, y + r, -Math.PI / 2),
    line(x + w, y + r, x + w, y + h - r), arc(x + w - r, y + h - r, 0),
    line(x + w - r, y + h, x + r, y + h), arc(x + r, y + h - r, Math.PI / 2),
    line(x, y + h - r, x, y + r), arc(x + r, y + r, Math.PI),
  ]
  const L = segs.reduce((a, g) => a + g.len, 0)
  return {
    L,
    at(s) {
      let rest = ((s % L) + L) % L
      for (const g of segs) {
        if (g.len > 0 && rest <= g.len) return g.at(rest / g.len)
        rest -= g.len
      }
      return segs[0].at(0)
    },
  }
}

export interface Cloud {
  /** The SVG path. */
  d: string
  /** The scallops' feet, in order; each arc runs from one to the next. */
  feet: [number, number][]
  /** Each arc's radius, same order. */
  radii: number[]
}

/** The cloud for a w x h box. */
export function cloud(w: number, h: number, style: CloudStyle = CUMULUS): Cloud {
  const { inset, chord, k, pattern } = style
  const P = roundedRect(inset, inset, w - 2 * inset, h - 2 * inset, Math.min(14, (h - 2 * inset) / 2))
  const sizes: number[] = []
  let sum = 0
  for (let i = 0; sum < P.L - chord * 0.5; i++) {
    const c = chord * pattern[i % pattern.length]
    sizes.push(c)
    sum += c
  }
  const scale = P.L / sum
  const feet: [number, number][] = []
  let s = 0
  for (const c of sizes) {
    feet.push(P.at(s))
    s += c * scale
  }
  const radii: number[] = []
  let d = `M${f1(feet[0][0])} ${f1(feet[0][1])}`
  for (let j = 0; j < feet.length; j++) {
    const a = feet[j]
    const b = feet[(j + 1) % feet.length]
    const r = Math.hypot(b[0] - a[0], b[1] - a[1]) * k
    radii.push(r)
    d += ` A${f1(r)} ${f1(r)} 0 0 1 ${f1(b[0])} ${f1(b[1])}`
  }
  return { d: d + 'Z', feet, radii }
}

/**
 * How far the cloud reaches past each side of its box. Exact for the arcs as
 * drawn: each is the minor arc of its circle swept clockwise, so its points
 * are sampled along that circle between its two feet.
 */
export function cloudReach(w: number, h: number, style: CloudStyle = CUMULUS): { left: number; top: number; right: number; bottom: number } {
  const { feet, radii } = cloud(w, h, style)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let j = 0; j < feet.length; j++) {
    const [ax, ay] = feet[j]
    const [bx, by] = feet[(j + 1) % feet.length]
    const r = radii[j]
    const mx = (ax + bx) / 2, my = (ay + by) / 2
    const half = Math.hypot(bx - ax, by - ay) / 2
    if (half === 0) continue
    // Sweep flag 1 in screen coordinates (y down) is clockwise; for the minor
    // arc of a clockwise walk the centre sits to the RIGHT of travel, i.e.
    // inward, and the bulge goes outward.
    const ux = (bx - ax) / (2 * half), uy = (by - ay) / (2 * half)
    const dist = Math.sqrt(Math.max(0, r * r - half * half))
    const cx = mx - uy * dist, cy = my + ux * dist
    const a0 = Math.atan2(ay - cy, ax - cx)
    let a1 = Math.atan2(by - cy, bx - cx)
    while (a1 < a0) a1 += 2 * Math.PI
    for (let i = 0; i <= 24; i++) {
      const a = a0 + ((a1 - a0) * i) / 24
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a)
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  return { left: -minX, top: -minY, right: maxX - w, bottom: maxY - h }
}
