import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { TreeNode } from '../client/spaces'
import { useClient } from '../client/ClientContext'
import { useRoomListSettings } from './roomListSettings'

const PRESET_ICONS = ['💬', '📌', '🎮', '🎨', '🔥', '⭐', '🛠️', '📁', '🤖', '👾', '🧪', '📷']

const HOUR = 3600 * 1000
const MENU_W = 224

// Right-click menu for a room/space row: favorite, notification mute/snooze,
// icon override, and leave. Rendered in a portal so the nav's overflow doesn't
// clip it. Closes on outside-click / Escape.
export function RoomContextMenu({
  node,
  x,
  y,
  onClose,
}: {
  node: TreeNode
  x: number
  y: number
  onClose: () => void
}) {
  const { client } = useClient()
  const settings = useRoomListSettings()
  const ref = useRef<HTMLDivElement>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [iconDraft, setIconDraft] = useState('')

  const isRoom = !node.isSpace
  const joined = node.membership === 'join'
  const muted = settings.isMutedNow(node.roomId)
  const favorite = settings.isFavorite(node.roomId)
  const hasIcon = settings.getIcon(node.roomId) !== undefined

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
  const top = Math.max(6, Math.min(y, window.innerHeight - 340))

  const setIcon = (icon: string) => {
    const trimmed = icon.trim()
    if (trimmed) settings.setIcon(node.roomId, trimmed)
    onClose()
  }
  const snooze = (ms: number) => {
    settings.setMute(node.roomId, Date.now() + ms)
    onClose()
  }
  const leave = async () => {
    if (!client) return
    try {
      await client.leave(node.roomId)
    } catch {
      // membership listener will keep the row if the leave failed
    }
    onClose()
  }

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
        {node.name || node.roomId}
      </div>

      {isRoom && joined && (
        <MenuItem onClick={() => { settings.toggleFavorite(node.roomId); onClose() }}>
          {favorite ? '★ Unfavorite' : '☆ Favorite'}
        </MenuItem>
      )}

      {isRoom && joined && (
        <>
          <Divider label="Notifications" />
          {muted ? (
            <MenuItem onClick={() => { settings.clearMute(node.roomId); onClose() }}>
              🔔 Unmute
            </MenuItem>
          ) : (
            <>
              <MenuItem onClick={() => { settings.setMute(node.roomId, null); onClose() }}>
                🔕 Mute
              </MenuItem>
              <MenuItem onClick={() => snooze(HOUR)}>💤 Snooze 1 hour</MenuItem>
              <MenuItem onClick={() => snooze(8 * HOUR)}>💤 Snooze 8 hours</MenuItem>
              <MenuItem onClick={() => snooze(24 * HOUR)}>💤 Snooze 24 hours</MenuItem>
            </>
          )}
        </>
      )}

      <Divider label="Icon" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, padding: '2px 6px 4px' }}>
        {PRESET_ICONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => setIcon(emoji)}
            style={{
              width: 24,
              height: 24,
              fontSize: 15,
              lineHeight: 1,
              display: 'grid',
              placeItems: 'center',
              background: 'transparent',
              border: '1px solid transparent',
              borderRadius: 5,
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cpd-color-bg-subtle-secondary)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            {emoji}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4, padding: '0 6px 4px' }}>
        <input
          value={iconDraft}
          onChange={(e) => setIconDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setIcon(iconDraft)
          }}
          placeholder="Custom emoji…"
          maxLength={4}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            padding: '3px 6px',
            color: 'var(--cpd-color-text-primary)',
            background: 'transparent',
            border: '1px solid rgba(128,128,128,0.35)',
            borderRadius: 5,
          }}
        />
        <button
          type="button"
          onClick={() => setIcon(iconDraft)}
          style={{
            fontSize: 12,
            padding: '3px 8px',
            borderRadius: 5,
            border: '1px solid rgba(128,128,128,0.35)',
            background: 'transparent',
            color: 'var(--cpd-color-text-primary)',
            cursor: 'pointer',
          }}
        >
          Set
        </button>
      </div>
      {hasIcon && (
        <MenuItem onClick={() => { settings.clearIcon(node.roomId); onClose() }}>
          ✕ Clear icon
        </MenuItem>
      )}

      {joined && (
        <>
          <Divider />
          {confirmLeave ? (
            <MenuItem danger onClick={leave}>
              ⚠ Click again to confirm
            </MenuItem>
          ) : (
            <MenuItem danger onClick={() => setConfirmLeave(true)}>
              {node.isSpace ? 'Leave space' : 'Leave room'}
            </MenuItem>
          )}
        </>
      )}
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

function Divider({ label }: { label?: string }) {
  return (
    <div
      style={{
        margin: '4px 8px 2px',
        paddingTop: 4,
        borderTop: '1px solid rgba(128,128,128,0.22)',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        color: 'var(--cpd-color-text-secondary)',
      }}
    >
      {label ?? ''}
    </div>
  )
}
