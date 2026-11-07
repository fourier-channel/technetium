// The styled bubbles' geometry (INTERFACE_OPTIONS IO4, IO5), proven over its
// input space rather than looked at once.
//
// The operator's three things to watch, 2026-11-07: "Make sure the bubbles
// don't clip into/over one another, that the tail is always pointed at the
// avatar, and that the tail leaves when the avatar advances to a new line."
//
// - NO OVERLAP. A shape may reach past its box only as far as the clearance
//   its row keeps (--tc-clear in index.css). The cloud's reach is computed
//   from the drawing itself for every box size a bubble can have; the ring's
//   from its box-shadow; and no animation may scale a bubble or its drawing
//   past 1 across the lines, since a transform paints over its neighbours
//   without moving them.
// - THE TAIL POINTS AT THE AVATAR. Every tail's ray, followed from the
//   bubble, enters the avatar's disc; the thought's circles sit in the gap
//   and step toward it.
// - THE TAIL LEAVES. The row turns it off on every line but the speaking one
//   (rowShape.check.ts holds the expression); here, that the cloud's circles
//   follow the same switch.
//
// Coordinates are the bubble's border box: (0,0) its top-left corner.
import { readFileSync } from 'node:fs'
import { CLOUD_TRAIL, DRAW_MARGIN, cloud, cloudReach } from '../src/ui/bubbleShape.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const fx = readFileSync(new URL('../src/ui/BubbleFx.tsx', import.meta.url), 'utf8')

const num = (re: RegExp, what: string): number => {
  const m = css.match(re)
  if (!m) { failures++; console.log('  FAIL could not read ' + what + ' from index.css'); return NaN }
  return Number(m[1])
}

const clearYell = num(/\.tc-row-speak\[data-clear='yelling'\] \{\s*--tc-clear: ([\d.]+)px;/, 'the yelling clearance')
const clearThink = num(/\.tc-row-speak\[data-clear='thinking'\] \{\s*--tc-clear: ([\d.]+)px;/, 'the thinking clearance')
const avW = num(/--tc-av-w: ([\d.]+)px;/, '--tc-av-w')
const bodyX = num(/--tc-body-x: ([\d.]+)px;/, '--tc-body-x')
const tailTop = num(/\/\* Level with the first line[\s\S]*?top: ([\d.]+)px;/, 'the tail top')
const tailHalf = num(/top: [\d.]+px;\s*width: 0;\s*height: 0;\s*border-top: ([\d.]+)px solid transparent;/, 'the tail half-height')
const tailLeft = num(/\.tc-bubble\[data-bubble='yelling'\]::before \{\s*left: (-?[\d.]+)px;/, 'the tail left')
const tailLen = num(/\.tc-bubble\[data-bubble='yelling'\]::before \{\s*left: -?[\d.]+px;\s*border-right: ([\d.]+)px solid/, 'the tail length')
const qTurn = num(/\.tc-bubble\[data-bubble='questioning'\]::after \{\s*transform: rotate\((-?[\d.]+)deg\);/, 'the question tail turn')

// The avatar: in the gutter, left edge --tc-body-x before the bubble's, top
// level with the bubble's (both ride .tc-row-speak).
const av = { cx: -bodyX + avW / 2, cy: avW / 2, r: avW / 2 }

console.log('== no overlap: what reaches past the box stays inside the clearance (IO4)')
{
  // Every size a bubble can be: one short word up to a wide paragraph.
  let worst = { side: '', reach: 0, w: 0, h: 0 }
  for (let w = 40; w <= 900; w += 7) {
    for (let h = 30; h <= 420; h += 5) {
      const r = cloudReach(w, h)
      for (const [side, v] of Object.entries(r)) if (v > worst.reach) worst = { side, reach: v, w, h }
    }
  }
  // The stroke is 1px, centred on the path: half of it is outside.
  check(`the cloud and its stroke reach at most the thinking clearance (${clearThink}px) on every side, every size`,
    worst.reach + 0.5 <= clearThink, worst)
  check('the drawing margin holds everything the cloud and its trail draw',
    worst.reach + 0.5 < DRAW_MARGIN &&
    CLOUD_TRAIL.every(([cx, cy, r]) => -cx + r + 0.5 < DRAW_MARGIN && Math.abs(cy) + r < DRAW_MARGIN + 30))
  const ring = css.match(/\.tc-bubble\[data-bubble='yelling'\]\[data-phase='settled'\] \{\s*box-shadow: 0 0 0 ([\d.]+)px var\(--tc-canvas\), 0 0 0 ([\d.]+)px var\(--tc-bub-ring\);/)
  check(`the yelling ring reaches at most the yelling clearance (${clearYell}px)`,
    !!ring && Number(ring[2]) <= clearYell && Number(ring[1]) < Number(ring[2]), ring?.slice(1))
  const spreads = [...(css.match(/@keyframes tcYellPop \{[\s\S]*?\n\}/)?.[0] ?? '').matchAll(/0 0 0 ([\d.]+)px var\(--tc-bub-ring\)/g)].map((m) => Number(m[1]))
  check('and so does every frame of its arrival', spreads.length > 0 && spreads.every((s) => s <= clearYell), spreads)
  const clearUsed = /\.tc-row-speak\[data-clear\] \{\s*margin-top: var\(--tc-clear\);/.test(css) &&
    /\.tc-row-speak\[data-clear\] > \.tc-bubble \{\s*margin-bottom: var\(--tc-clear\);/.test(css) &&
    /max-width: calc\(min\(100%, var\(--tc-chat-w\)\) - var\(--tc-clear, 0px\)\);/.test(css)
  check('the clearance is kept above, below and beside the shaped bubble', clearUsed)
}

console.log('== no overlap: nothing animates taller than it rests')
{
  for (const name of ['tcYellPop', 'tcCloudMorph']) {
    const block = css.match(new RegExp(`@keyframes ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? ''
    const scales = [...block.matchAll(/scale\(([\d.]+)(?:,\s*([\d.]+))?\)/g)].map((m) => Number(m[2] ?? m[1]))
    check(`${name} never scales past 1 across the lines`, scales.length > 0 && scales.every((s) => s <= 1), scales)
  }
  check('the easings do not overshoot (no control point above 1)',
    [...css.matchAll(/animation: tc(?:YellPop|CloudMorph) \d+ms cubic-bezier\(([^)]*)\)/g)].every((m) => {
      const [, y1, , y2] = m[1].split(',').map(Number)
      return y1 <= 1 && y2 <= 1
    }))
  // The tail is inside the bubble's own height, even on a one-line bubble.
  const oneLine = 14 * 1.35 + 2 * 6 + 2
  check(`the tail stays within a one-line bubble's height (${oneLine.toFixed(1)}px)`, tailTop + 1 + 2 * tailHalf <= oneLine,
    { bottom: tailTop + 1 + 2 * tailHalf })
}

console.log('== the tail points at the avatar (IO5)')
{
  // A ray from (px,py) along (dx,dy): does it enter the disc ahead of it?
  const hits = (px: number, py: number, dx: number, dy: number) => {
    const fx2 = av.cx - px, fy = av.cy - py
    const along = fx2 * dx + fy * dy
    const across = Math.abs(fx2 * dy - fy * dx)
    return along > 0 && across < av.r
  }
  // The triangle's base on the bubble (its right side, +1 for the border the
  // padding box starts inside), its point tailLen to the left.
  const baseX = tailLeft + tailLen + 1
  const midY = tailTop + 1 + tailHalf
  check('a plain, shouted or questioned tail is aimed into the avatar', hits(baseX, midY, -1, 0), { baseX, midY, av })
  check('and its point stays in the gap, short of the disc', baseX - tailLen > av.cx + av.r)
  const t = (qTurn * Math.PI) / 180
  // rotate() turns clockwise on screen; the point's direction (-1, 0) becomes:
  const qd = [-Math.cos(t), -Math.sin(t)]
  check(`the raised question tail (${qTurn}deg) still lands on the disc, above its centre`,
    hits(baseX, midY, qd[0], qd[1]) && qd[1] < 0, { qd })
  const sorted = [...CLOUD_TRAIL]
  const dist = (c: readonly number[]) => Math.hypot(c[0] - av.cx, c[1] - av.cy)
  check('the thought\'s circles sit in the gap between the avatar and the cloud',
    sorted.every(([cx, , r]) => cx + r < 0 && cx - r > av.cx + av.r - 0.5))
  check('and step toward the avatar, getting smaller',
    sorted.every((c, i) => i === 0 || (dist(c) < dist(sorted[i - 1]) && c[2] < sorted[i - 1][2])))
  check('the circles are level with the avatar\'s face',
    sorted.every(([, cy]) => Math.abs(cy - av.cy) < av.r / 2))
}

console.log('== the tail leaves the lines the avatar has left')
check('the cloud draws its circles only when the row says this line speaks',
  /\{d && tail && CLOUD_TRAIL\.map/.test(fx))
check('a turned-off tail draws no triangle',
  /\.tc-bubble\[data-tail='off'\]::before,\s*\n\.tc-bubble\[data-tail='off'\]::after \{\s*content: none;/.test(css))

console.log('== the cloud is a closed outline')
{
  for (const [w, h] of [[40, 30], [120, 33], [600, 33], [300, 200]]) {
    const c = cloud(w, h)
    check(`${w}x${h}: closes, every arc a minor arc`, c.d.endsWith('Z') && c.feet.length >= 4 &&
      c.radii.every((r, j) => {
        const a = c.feet[j], b = c.feet[(j + 1) % c.feet.length]
        return r >= Math.hypot(b[0] - a[0], b[1] - a[1]) / 2
      }))
  }
}

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nbubble shape: all checks passed')
