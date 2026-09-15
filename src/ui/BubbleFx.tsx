import { useMemo, type CSSProperties } from 'react'
import type { BubbleTone } from '../client/bubbleTone'
import { qmarks } from '../client/bubbleFx'
import type { BubblePhase } from './useBubbleFx'

// ---------------------------------------------------------------------------
// What a bubble grows on top of itself (ui-depth-v1 U5).
//
// Two things, and neither of them holds any layout:
//
//   the SHAPE LAYER -- an empty span behind the words, whose two
//   pseudo-elements carry the jagged burst or the cloud. All of that is CSS;
//   the layer exists because a silhouette that keeps its border colour cannot
//   be a border (see the animators block in index.css).
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
}: {
  tone: BubbleTone
  phase: BubblePhase
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
      <span className="tc-bubble-fx" aria-hidden="true" />
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
