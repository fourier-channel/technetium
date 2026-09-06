import { useRef } from 'react'

// A drag grip. Horizontal by default (reports dx); `vertical` reports dy.
// Pointer capture, so a fast drag that leaves the strip keeps dragging.
export function ResizeHandle({ onDrag, vertical = false }: { onDrag: (delta: number) => void; vertical?: boolean }) {
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
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={vertical
        ? { height: 5, flexShrink: 0, cursor: 'row-resize', background: 'transparent', width: '100%' }
        : { width: 5, flexShrink: 0, cursor: 'col-resize', background: 'transparent', alignSelf: 'stretch' }}
    />
  )
}
