import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Room } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// Right-click menu for another user's puck. Non-admins get "Inspect" (which
// opens the profile card); admins/mods additionally get "Force-collapse".
//
// The profile card itself used to live here as DomainProfileCard. It was the
// SEED of a full profile module and never actually domain-specific, so S5
// promoted it to ui/ProfileCard.tsx -- domain mode is now just its first
// caller. A future fourier-signature integration would let a user "own" that
// profile across platforms.
// ---------------------------------------------------------------------------

const MENU_W = 220

export function DomainUserMenu({
  x,
  y,
  userId,
  room,
  isAdmin,
  onInspect,
  onForceCollapse,
  onThrow,
  onClose,
}: {
  x: number
  y: number
  userId: string
  room: Room
  isAdmin: boolean
  onInspect: () => void
  onForceCollapse: () => void
  onThrow?: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const member = room.getMember(userId)
  const name = member?.name || userId

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const left = Math.max(6, Math.min(x, window.innerWidth - MENU_W - 8))
  const top = Math.max(6, Math.min(y, window.innerHeight - 160))

  return createPortal(
    <div
      ref={ref}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left,
        top,
        width: MENU_W,
        zIndex: 1000,
        fontFamily: 'var(--tc-ui-font)',
        fontSize: 13,
        color: 'var(--cpd-color-text-primary)',
        background: 'var(--cpd-color-bg-canvas-default)',
        border: '1px solid rgba(128,128,128,0.35)',
        borderRadius: 8,
        boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
        padding: 4,
        userSelect: 'none',
      }}
    >
      <div
        style={{
          padding: '4px 8px 6px',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--cpd-color-text-secondary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </div>

      <MenuItem onClick={onInspect}>Inspect</MenuItem>

      {onThrow && <MenuItem onClick={onThrow}>Throw {'⭐'}</MenuItem>}

      {isAdmin && <MenuItem danger onClick={onForceCollapse}>Force-collapse domain</MenuItem>}
    </div>,
    document.body,
  )
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: ReactNode
  onClick: () => void
  danger?: boolean
}) {
  const base: CSSProperties = {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    fontSize: 13,
    padding: '6px 8px',
    borderRadius: 5,
    border: 'none',
    background: 'transparent',
    color: danger ? 'var(--cpd-color-text-critical-primary)' : 'var(--cpd-color-text-primary)',
    cursor: 'pointer',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      style={base}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cpd-color-bg-subtle-secondary)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {children}
    </button>
  )
}
