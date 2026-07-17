import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Room } from 'matrix-js-sdk'
import { AuthedImage } from './AuthedImage'
import { honorificFor } from '../client/members'

// ---------------------------------------------------------------------------
// Right-click menu for another user's puck, plus a basic profile card. Non-
// admins get "Inspect" (opens the profile); admins/mods additionally get
// "Force-collapse". The profile is deliberately minimal (avatar, name,
// user:server, standing) but scoped as the SEED of a full profile module --
// hence its own component and file. A future fourier-signature integration would
// let a user "own" this profile across platforms.
// ---------------------------------------------------------------------------

const MENU_W = 220

function initials(name: string): string {
  const cleaned = name.replace(/^[@#!]/, '').trim()
  return cleaned.slice(0, 2).toUpperCase() || '?'
}

const HONORIFIC_LABEL: Record<string, string> = {
  '~': 'Owner',
  '@': 'Moderator',
  '+': 'Voice',
}

export function DomainUserMenu({
  x,
  y,
  userId,
  room,
  isAdmin,
  onInspect,
  onForceCollapse,
  onClose,
}: {
  x: number
  y: number
  userId: string
  room: Room
  isAdmin: boolean
  onInspect: () => void
  onForceCollapse: () => void
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

      {isAdmin && <MenuItem danger onClick={onForceCollapse}>Force-collapse domain</MenuItem>}
    </div>,
    document.body,
  )
}

export function DomainProfileCard({
  x,
  y,
  userId,
  room,
  onClose,
}: {
  x: number
  y: number
  userId: string
  room: Room
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const member = room.getMember(userId)
  const name = member?.name || userId
  const avatarMxc = member?.getMxcAvatarUrl() ?? null
  const pl = member?.powerLevel ?? 0
  const honorific = honorificFor(pl)
  const standing = honorific ? HONORIFIC_LABEL[honorific] : 'Member'

  // Split "@user:server" for display.
  const bare = userId.replace(/^@/, '')
  const [uname, ...rest] = bare.split(':')
  const server = rest.join(':')

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

  const W = 250
  const left = Math.max(6, Math.min(x, window.innerWidth - W - 8))
  const top = Math.max(6, Math.min(y, window.innerHeight - 190))

  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left,
        top,
        width: W,
        zIndex: 1001,
        padding: 14,
        borderRadius: 12,
        fontFamily: 'var(--tc-ui-font, inherit)',
        color: 'var(--cpd-color-text-primary)',
        background: 'var(--cpd-color-bg-canvas-default)',
        border: '1px solid rgba(128,128,128,0.35)',
        boxShadow: '0 12px 34px rgba(0,0,0,0.5)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            overflow: 'hidden',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
            fontSize: 20,
            fontWeight: 700,
            color: '#fff',
            background: 'var(--cpd-color-bg-subtle-primary)',
          }}
        >
          {avatarMxc ? (
            <AuthedImage mxc={avatarMxc} width={180} fill transparentLoading alt="" fallback={initials(name)} viaHomeserver />
          ) : (
            initials(name)
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </div>
          <div style={{ fontSize: 12, color: 'var(--cpd-color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {uname}
            {server ? <span style={{ opacity: 0.7 }}>:{server}</span> : null}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Tag>{standing}</Tag>
        <Tag>PL {pl}</Tag>
      </div>
    </div>,
    document.body,
  )
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 999,
        background: 'var(--cpd-color-bg-subtle-secondary)',
        color: 'var(--cpd-color-text-primary)',
      }}
    >
      {children}
    </span>
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
