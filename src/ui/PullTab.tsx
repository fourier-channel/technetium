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
  open,
  label,
  onClick,
  style,
  target,
  attach = 'start',
}: {
  pull: 'down' | 'up' | 'left' | 'right'
  // Whether the panel this tab controls is OPEN now: a closed one's tab pulls
  // it out (green, shallower), an open one's puts it back (orange, deeper).
  // Stated, not read off `pull`: a tab on the screen's left edge pulls the
  // room list out rightwards, where the thread's close tab also points right.
  open: boolean
  label: string
  onClick: () => void
  style?: CSSProperties
  // For tests and tooling: which panel this tab pulls.
  target: string
  // Which side of the moving edge it sits on (tabRide.ts): outside the border
  // it pulls from ('start'), or inside the panel at its edge -- 'above' it for
  // a panel that comes down from the top, 'right' of it for one that comes in
  // from the right. A transform in the stylesheet, so it costs nothing.
  attach?: 'start' | 'above' | 'right'
}) {
  // ONE "v", turned by the stylesheet to point where the panel moves: the
  // sideways tabs are the same tab rotated 90 degrees (launch-polish L15).
  // ASCII on purpose (committed content is ASCII-only).
  const chevron = 'v'
  return (
    <button
      type="button"
      className="tc-pulltab"
      data-pull={pull}
      data-open={open ? 'true' : 'false'}
      data-target={target}
      data-attach={attach}
      onClick={onClick}
      aria-label={label}
      style={style}
    >
      <span className="tc-pulltab-tip">{label}</span>
      <span aria-hidden="true" className="tc-pulltab-chevron">{chevron}</span>
    </button>
  )
}
