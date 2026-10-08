import type { DividerTone } from './dividerTone'
import { useEdgeDrag, type EdgeRef } from './edgeDrag'

// A drag grip -- the divider between two panels. It moves one panel's edge
// (`edge`), through the one drag gesture every divider shares (edgeDrag.ts:
// a target, not steps; no easing while held). Vertical when the edge is on y.
//
// `tone` is what the divider is OUTLINED in, and it belongs to the panel this
// grip leads: green while that panel is standing furniture, orange while it is
// a panel somebody pulled out. The rule is in dividerTone.ts, where a check
// can hold it; nothing is decided here. The default is neutral so a caller that
// has not thought about it gets the quiet answer rather than a lie.
export const DIVIDER_PX = 7

export function ResizeHandle({
  edge,
  tone = 'neutral',
  label,
}: {
  edge: EdgeRef
  tone?: DividerTone
  // What this divider resizes, for anyone not looking at the screen.
  label?: string
}) {
  const vertical = edge.axis === 'y'
  const drag = useEdgeDrag(edge)
  return (
    <div
      className="tc-divider"
      data-axis={vertical ? 'y' : 'x'}
      data-tone={tone}
      role="separator"
      aria-orientation={vertical ? 'horizontal' : 'vertical'}
      aria-label={label}
      {...drag}
    >
      {/* The rail. Its own element rather than a pseudo-element on the grip,
          because it SQUASHES under the pointer and a transform on the grip
          itself would move the hit area out from under the cursor. */}
      <span className="tc-divider-rail" aria-hidden="true" />
    </div>
  )
}
