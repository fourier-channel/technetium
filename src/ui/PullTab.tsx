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
  // ASCII on purpose (org ruling: committed content is ASCII-only); the
  // domain tab uses the same < and >.
  const chevron = pull === 'down' ? 'v' : pull === 'up' ? '^' : pull === 'left' ? '<' : '>'
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
