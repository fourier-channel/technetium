import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { TreeNode } from '../client/spaces'
import { useClient } from '../client/ClientContext'
import { useRoomListSettings } from './roomListSettings'
import { markNodeRead } from '../client/markRead'
import { describeInviteError } from '../client/userDirectory'
import { reportAlways } from '../client/report'

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
  // A destructive action that fails must say so; the row staying put is not an
  // explanation.
  const [leaveError, setLeaveError] = useState<string | null>(null)
  const [iconDraft, setIconDraft] = useState('')
  // Non-null while a space-wide mark-as-read is running, so the row can say
  // what it is doing instead of looking like a dead click.
  const [markingRead, setMarkingRead] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')

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
  const markRead = async () => {
    if (!client || markingRead) return
    setMarkingRead(true)
    try {
      const result = await markNodeRead(client, node)
      if (result.truncated) {
        console.warn(
          `Mark as read: stopped after ${result.attempted} rooms; this space has more.`,
        )
      }
    } finally {
      setMarkingRead(false)
      onClose()
    }
  }

  const snooze = (ms: number) => {
    settings.setMute(node.roomId, Date.now() + ms)
    onClose()
  }
  const leave = async () => {
    if (!client) return
    try {
      await client.leave(node.roomId)
    } catch (err) {
      // The membership listener keeps the row, so the UI stays truthful -- but
      // the user clicked a destructive action and deserves to know it did not
      // happen, and why.
      reportAlways('room: leave', err)
      setLeaveError(describeInviteError(err))
      return
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

      {leaveError && (
        <div
          role="alert"
          style={{
            fontSize: 11,
            margin: '2px 6px 4px',
            padding: '4px 6px',
            borderRadius: 5,
            color: 'var(--cpd-color-text-critical-primary, #ff6b6b)',
            background: 'var(--cpd-color-bg-subtle-secondary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {leaveError}
        </div>
      )}

      {joined && (
        <>
          <Divider label="Name" />
          {renaming ? (
            <div style={{ display: 'flex', gap: 4, padding: '2px 6px 6px' }}>
              <input
                type="text"
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    settings.setRename(node.roomId, renameDraft)
                    onClose()
                  }
                  if (e.key === 'Escape') setRenaming(false)
                }}
                placeholder={node.name || node.roomId}
                aria-label="Custom room name"
                autoFocus
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12,
                  padding: '3px 6px',
                  borderRadius: 5,
                  border: '1px solid rgba(128,128,128,0.35)',
                  background: 'transparent',
                  color: 'inherit',
                }}
              />
              <button
                type="button"
                onClick={() => {
                  settings.setRename(node.roomId, renameDraft)
                  onClose()
                }}
                style={{ fontSize: 12 }}
              >
                Set
              </button>
            </div>
          ) : (
            <MenuItem
              onClick={() => {
                setRenameDraft(settings.getRename(node.roomId) ?? '')
                setRenaming(true)
              }}
            >
              ✎ Customize name
            </MenuItem>
          )}
          {settings.getRename(node.roomId) !== undefined && !renaming && (
            <MenuItem onClick={() => { settings.clearRename(node.roomId); onClose() }}>
              ↩ Reset to server name
            </MenuItem>
          )}
        </>
      )}

      {joined && (
        <MenuItem onClick={() => void markRead()}>
          {markingRead
            ? '✓ Marking...'
            : node.isSpace
              ? '✓ Mark space as read'
              : '✓ Mark as read'}
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
