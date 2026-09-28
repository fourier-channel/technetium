import type { CSSProperties } from 'react'

// A tab on a border, saying that something can be pulled from here -- down,
// up, out, or back -- the way the domain's tab does on the chat's edge.
// Operator ruling 2026-09-06: no more open/close buttons; every panel that
// can be summoned or dismissed shows its tab on the border it will cross.
//
// `pull` is the direction the panel MOVES when the tab is used, and the
// chevron points that way. The caller positions it (absolute within a
// positioned ancestor) because only the caller knows which border this is.
export function PullTab({
  pull,
  label,
  onClick,
  style,
  target,
}: {
  pull: 'down' | 'up' | 'left' | 'right'
  label: string
  onClick: () => void
  style?: CSSProperties
  // For tests and tooling: which panel this tab pulls.
  target: string
}) {
  // ONE "v", turned by the stylesheet to point where the panel moves: the
  // sideways tabs are the same tab rotated 90 degrees (launch-polish L15).
  // Down and left pull a collapsed panel out (green); up and right put an
  // expanded one back (orange). ASCII on purpose (committed content is
  // ASCII-only).
  const chevron = 'v'
  return (
    <button
      type="button"
      className="tc-pulltab"
      data-pull={pull}
      data-target={target}
      onClick={onClick}
      aria-label={label}
      style={style}
    >
      <span className="tc-pulltab-tip">{label}</span>
      <span aria-hidden="true" className="tc-pulltab-chevron">{chevron}</span>
    </button>
  )
}
