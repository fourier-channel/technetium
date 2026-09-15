import { useRef } from 'react'
import type { DividerTone } from './dividerTone'

// A drag grip -- the divider between two panels. Horizontal by default (reports
// dx); `vertical` reports dy. Pointer capture, so a fast drag that leaves the
// strip keeps dragging.
//
// `tone` is what the divider is OUTLINED in, and it belongs to the panel this
// grip leads: green while that panel is standing furniture, orange while it is
// a panel somebody pulled out. The rule is in dividerTone.ts, where a check
// can hold it; nothing is decided here. The default is neutral so a caller that
// has not thought about it gets the quiet answer rather than a lie.
export const DIVIDER_PX = 7

export function ResizeHandle({
  onDrag,
  vertical = false,
  tone = 'neutral',
  label,
}: {
  onDrag: (delta: number) => void
  vertical?: boolean
  tone?: DividerTone
  // What this divider resizes, for anyone not looking at the screen.
  label?: string
}) {
  const start = useRef(0)
  const pos = (e: React.PointerEvent<HTMLDivElement>) => (vertical ? e.clientY : e.clientX)
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    start.current = pos(e)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const d = pos(e) - start.current
    start.current = pos(e)
    if (d !== 0) onDrag(d)
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }
  return (
    <div
      className="tc-divider"
      data-axis={vertical ? 'y' : 'x'}
      data-tone={tone}
      role="separator"
      aria-orientation={vertical ? 'horizontal' : 'vertical'}
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* The rail. Its own element rather than a pseudo-element on the grip,
          because it SQUASHES under the pointer and a transform on the grip
          itself would move the hit area out from under the cursor. */}
      <span className="tc-divider-rail" aria-hidden="true" />
    </div>
  )
}
