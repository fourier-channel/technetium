import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MatrixClient, Room } from 'matrix-js-sdk'

// W2.8 -- a minimal "which room?" dialog. Kept generic (a title, a filter, a
// pick callback) because forwarding is not the last thing that will need one.

interface Choice {
  room: Room
  label: string
}

export function RoomPicker({
  client,
  title,
  confirmLabel,
  excludeRoomId,
  onPick,
  onClose,
}: {
  client: MatrixClient | null
  title: string
  confirmLabel: string
  // Usually the room being forwarded FROM: offering it is confusing, and it is
  // the easiest mis-click to make.
  excludeRoomId?: string
  onPick: (room: Room) => void
  onClose: () => void
}) {
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)

  const choices = useMemo<Choice[]>(() => {
    if (!client) return []
    return client
      .getRooms()
      .filter((r) => r.getMyMembership() === 'join')
      .filter((r) => r.roomId !== excludeRoomId)
      // A space is a container, not somewhere a message can be sent.
      .filter((r) => !r.isSpaceRoom())
      .map((r) => ({ room: r, label: r.name || r.roomId }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [client, excludeRoomId])

  const q = filter.trim().toLowerCase()
  const shown = q ? choices.filter((c) => c.label.toLowerCase().includes(q)) : choices

  const pick = (room: Room) => {
    if (busy) return
    setBusy(true)
    onPick(room)
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(0,0,0,0.5)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 380,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 16,
          borderRadius: 12,
          fontFamily: 'var(--tc-ui-font, inherit)',
          color: 'var(--cpd-color-text-primary)',
          background: 'var(--cpd-color-bg-canvas-default)',
          border: '1px solid rgba(128,128,128,0.35)',
          boxShadow: '0 16px 44px rgba(0,0,0,0.55)',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>{title}</div>

        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter rooms..."
          aria-label="Filter rooms"
          autoFocus
          style={{
            fontSize: 13,
            padding: '6px 10px',
            marginBottom: 10,
            borderRadius: 8,
            border: '1px solid rgba(128,128,128,0.35)',
            background: 'transparent',
            color: 'inherit',
          }}
        />

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {shown.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--cpd-color-text-secondary)', padding: '8px 0' }}>
              {choices.length === 0 ? 'No rooms available.' : 'No rooms match that filter.'}
            </div>
          ) : (
            shown.map((c) => (
              <button
                key={c.room.roomId}
                type="button"
                disabled={busy}
                onClick={() => pick(c.room)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  fontSize: 13,
                  padding: '7px 9px',
                  borderRadius: 6,
                  border: 'none',
                  background: 'transparent',
                  color: 'inherit',
                  cursor: busy ? 'default' : 'pointer',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = 'var(--cpd-color-bg-subtle-secondary)')
                }
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {c.label}
              </button>
            ))
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          <span style={{ fontSize: 11, color: 'var(--cpd-color-text-secondary)' }}>
            {busy ? `${confirmLabel}...` : `${shown.length} room${shown.length === 1 ? '' : 's'}`}
          </span>
          <button type="button" onClick={onClose} style={{ fontSize: 13, padding: '5px 12px' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
