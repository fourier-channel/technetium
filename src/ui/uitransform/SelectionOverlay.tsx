import type { PointerEvent as ReactPointerEvent } from 'react'
import type { UiTransformConfig } from './config'
import { HANDLE_IDS, type Box, type HandleId } from './transform'

// ---------------------------------------------------------------------------
// The selection chrome: an animated marching-ants border around the target box
// plus square/circle resize handles at the 8 interaction points. Purely
// presentational + config-driven -- it reports handle pointer-downs upward and
// knows nothing about what it's transforming. Part of the portable module.
// ---------------------------------------------------------------------------

const CURSOR: Record<HandleId, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
}

function handlePoint(box: Box, id: HandleId): { x: number; y: number } {
  const midX = box.left + box.width / 2
  const midY = box.top + box.height / 2
  const right = box.left + box.width
  const bottom = box.top + box.height
  switch (id) {
    case 'nw':
      return { x: box.left, y: box.top }
    case 'n':
      return { x: midX, y: box.top }
    case 'ne':
      return { x: right, y: box.top }
    case 'e':
      return { x: right, y: midY }
    case 'se':
      return { x: right, y: bottom }
    case 's':
      return { x: midX, y: bottom }
    case 'sw':
      return { x: box.left, y: bottom }
    case 'w':
      return { x: box.left, y: midY }
  }
}

export function SelectionOverlay({
  box,
  config,
  onHandleDown,
}: {
  box: Box
  config: UiTransformConfig
  onHandleDown: (id: HandleId, e: ReactPointerEvent) => void
}) {
  const { marchingAnts: ma, handle: h } = config
  const shift = ma.dash + ma.gap

  return (
    <>
      <style>{`@keyframes uitransform-ants { to { stroke-dashoffset: -${shift}px; } }`}</style>
      {/* Marching-ants border (SVG so the dash size is exact + animatable). */}
      <svg
        width={box.width}
        height={box.height}
        style={{
          position: 'absolute',
          left: box.left,
          top: box.top,
          overflow: 'visible',
          pointerEvents: 'none',
          zIndex: 70,
        }}
      >
        <rect
          x={ma.thickness / 2}
          y={ma.thickness / 2}
          width={Math.max(0, box.width - ma.thickness)}
          height={Math.max(0, box.height - ma.thickness)}
          fill="none"
          stroke={ma.color}
          strokeWidth={ma.thickness}
          strokeDasharray={`${ma.dash} ${ma.gap}`}
          style={{ animation: `uitransform-ants ${ma.periodMs}ms linear infinite` }}
        />
      </svg>
      {/* Resize handles. */}
      {HANDLE_IDS.map((id) => {
        const p = handlePoint(box, id)
        return (
          <div
            key={id}
            onPointerDown={(e) => {
              e.stopPropagation()
              onHandleDown(id, e)
            }}
            style={{
              position: 'absolute',
              left: p.x - h.size / 2,
              top: p.y - h.size / 2,
              width: h.size,
              height: h.size,
              background: h.fill,
              border: `${h.strokeWidth}px solid ${h.stroke}`,
              borderRadius: h.shape === 'circle' ? '50%' : 2,
              boxSizing: 'border-box',
              cursor: CURSOR[id],
              pointerEvents: 'auto',
              zIndex: 71,
            }}
          />
        )
      })}
    </>
  )
}
