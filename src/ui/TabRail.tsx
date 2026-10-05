import type { CSSProperties, ReactNode } from 'react'
import { railStyle } from './tabRide'

// The clip and the rail a pull tab rides in (tabRide.ts says why). The clip
// is the area the panel moves in -- fixed, so the panel's edge can carry the
// tab into and out of view; the rail inside it is that area translated by the
// panel's edge, on the panel's duration. Neither takes a pointer: only the
// tab does.
export function TabRail({
  axis,
  offset,
  durationMs,
  clip,
  children,
}: {
  axis: 'x' | 'y'
  offset: string
  durationMs: number
  clip: CSSProperties
  children: ReactNode
}) {
  return (
    <div className="tc-tabclip" style={clip}>
      <div className="tc-tabrail" style={railStyle(axis, offset, durationMs)}>
        {children}
      </div>
    </div>
  )
}
