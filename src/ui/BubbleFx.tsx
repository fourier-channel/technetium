import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { BubbleTone } from '../client/bubbleTone'
import { qmarks } from '../client/bubbleFx'
import { CLOUD_TRAIL, DRAW_MARGIN, cloud } from './bubbleShape'
import type { BubblePhase } from './useBubbleFx'

// ---------------------------------------------------------------------------
// What a bubble grows on top of itself (ui-depth-v1 U5; the shapes picked
// 2026-11-07, INTERFACE_OPTIONS IO1-IO3).
//
// Two things, and neither of them holds any layout:
//
//   the CLOUD -- the thought's outline, an SVG drawn to the bubble's MEASURED
//   box (bubbleShape.ts), with its two-circle trail toward the avatar when the
//   line is the one the avatar speaks. The double ring and the raised tail
//   are CSS alone and need nothing here.
//
//   the QUESTION MARKS -- real elements, because there are several of them, at
//   seeded positions, each with its own drift and spin. They exist only while
//   the tone is questioning and only during `playing`, and the hook takes them
//   away on a TIMER rather than on animationend (G-tc06).
//
// Nothing here is focusable, hit-testable or in flow, so a bubble is the same
// size and the same shape to the layout engine whatever it is doing (G-tp19).
// ---------------------------------------------------------------------------

export function BubbleFx({
  tone,
  phase,
  seed,
  tail,
}: {
  tone: BubbleTone
  phase: BubblePhase
  // Whether this line's bubble points at the avatar (the speaking line, in a
  // panel that draws avatars). The cloud's trail is its tail.
  tail: boolean
  // The event id. Same seed, same marks, every time -- the reasoning is
  // memberEvents.ts's: a fresh random pick per replay reads as a rendering
  // glitch rather than as character.
  seed: string
}) {
  const marks = useMemo(
    () => (tone === 'questioning' ? qmarks(seed) : []),
    [tone, seed],
  )
  return (
    <>
      {tone === 'thinking' && <Cloud tail={tail} />}
      {tone === 'questioning' && phase === 'playing' && (
        <span className="tc-qmarks" aria-hidden="true">
          {marks.map((m, i) => (
            <span
              key={i}
              className="tc-qmark"
              style={
                {
                  left: `${m.xPct}%`,
                  fontSize: m.sizePx,
                  animationDelay: `${m.delayMs}ms`,
                  '--tc-q-drift': `${m.driftPx}px`,
                  '--tc-q-rise': `${m.risePx}px`,
                  '--tc-q-spin': `${m.spinDeg}deg`,
                } as CSSProperties
              }
            >
              ?
            </span>
          ))}
        </span>
      )}
    </>
  )
}

// The thought's outline, drawn to its bubble's border box. Measured by a
// ResizeObserver on the bubble, so a line that rewraps (a narrower panel, an
// edit) is redrawn to its new size; until the first measurement nothing is
// drawn, and the bubble shows its own plain fill (index.css).
function Cloud({ tail }: { tail: boolean }) {
  const ref = useRef<SVGSVGElement | null>(null)
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const bubble = ref.current?.parentElement
    if (!bubble) return
    const measure = () => {
      const w = bubble.offsetWidth
      const h = bubble.offsetHeight
      setBox((was) => (was && was.w === w && was.h === h ? was : { w, h }))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(bubble)
    return () => ro.disconnect()
  }, [])
  const d = useMemo(() => (box && box.w > 0 && box.h > 0 ? cloud(box.w, box.h).d : null), [box])
  const M = DRAW_MARGIN
  const w = box?.w ?? 0
  const h = box?.h ?? 0
  return (
    <svg
      ref={ref}
      className="tc-cloud"
      aria-hidden="true"
      width={w + 2 * M}
      height={h + 2 * M}
      viewBox={`${-M} ${-M} ${w + 2 * M} ${h + 2 * M}`}
      style={{ '--tc-cloud-m': `${M}px` } as CSSProperties}
      data-drawn={d ? 'true' : undefined}
    >
      {d && <path d={d} />}
      {d && tail && CLOUD_TRAIL.map(([cx, cy, r], i) => <circle key={i} cx={cx} cy={cy} r={r} />)}
    </svg>
  )
}
