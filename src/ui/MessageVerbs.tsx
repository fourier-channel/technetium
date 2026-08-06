import { useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { MatrixEvent, Room } from 'matrix-js-sdk'
import { useClient } from '../client/ClientContext'
import { isEditableContent } from '../client/editContent'
import { eventPreview } from '../client/eventPreview'
import { MessageActionsProvider } from './MessageActionBar'
import { useComposerMode } from './composerMode'
import type { MessageActionBuilder } from './messageActions'

// ---------------------------------------------------------------------------
// Wave 2 -- the one place message verbs are assembled.
//
// Both surfaces that render Rows (the room timeline and the thread panel) wrap
// their list in this, so every verb reaches both without either surface
// knowing what the verbs are. Later verbs are added HERE, not in Row.
//
// A builder returning null means "this verb does not apply to this item" --
// no reply to a redacted message, no edit of someone else's.
// ---------------------------------------------------------------------------

// Verbs act on a real message. Galleries count (they are m.image messages);
// redacted, encrypted and state-ish rows do not.
function isActionable(kind: string): boolean {
  return kind === 'message' || kind === 'gallery'
}

export function MessageVerbsProvider({ room, children }: { room: Room | null; children: ReactNode }) {
  const { client } = useClient()
  const { reply, edit } = useComposerMode()
  const myUserId = client?.getUserId() ?? null
  // Redaction is destructive and irreversible, so it is two-step: the action
  // bar arms it, this dialog confirms it.
  const [pendingDelete, setPendingDelete] = useState<MatrixEvent | null>(null)

  // May the local user redact OTHER people's messages here? Own messages are
  // always redactable by their sender.
  const canRedactOthers = useMemo(() => {
    if (!room || !myUserId) return false
    const me = room.getMember(myUserId)
    if (!me) return false
    return room.currentState.hasSufficientPowerLevelFor('redact', me.powerLevel)
  }, [room, myUserId])

  const builders = useMemo<MessageActionBuilder[]>(
    () => [
      (item) => {
        if (!isActionable(item.kind)) return null
        return {
          id: 'reply',
          label: 'Reply',
          icon: '↩', // leftwards arrow with hook
          onSelect: () => reply(item.event),
        }
      },
      (item) => {
        // Matrix lets you send an m.replace for anyone's event; the server
        // accepts it and only well-behaved clients ignore it. Our own reader
        // rejects a forged edit (relations.ts), so offering Edit on someone
        // else's message would produce an event that changes nothing here and
        // may change something elsewhere. Own messages only.
        if (!isActionable(item.kind)) return null
        if (!myUserId || item.event.getSender() !== myUserId) return null
        if (!isEditableContent(item.content)) return null
        return {
          id: 'edit',
          label: 'Edit',
          icon: '✎', // lower right pencil
          onSelect: () => edit(item.event, item.content),
        }
      },
      (item) => {
        if (!isActionable(item.kind)) return null
        const isMine = !!myUserId && item.event.getSender() === myUserId
        // Hidden rather than shown-and-failing: a Delete that always 403s
        // teaches people to distrust the whole bar.
        if (!isMine && !canRedactOthers) return null
        return {
          id: 'delete',
          label: isMine ? 'Delete' : 'Delete (moderator)',
          icon: '🗑',
          danger: true,
          onSelect: () => setPendingDelete(item.event),
        }
      },
    ],
    [reply, edit, myUserId, canRedactOthers],
  )

  const confirmDelete = async () => {
    const ev = pendingDelete
    setPendingDelete(null)
    if (!client || !ev) return
    const roomId = ev.getRoomId()
    const eventId = ev.getId()
    if (!roomId || !eventId) return
    try {
      // G-bf03: called as a method so it keeps its `this`.
      await client.redactEvent(roomId, eventId)
    } catch (err) {
      console.error('Redaction failed:', err)
    }
  }

  return (
    <MessageActionsProvider builders={builders}>
      {children}
      {pendingDelete && (
        <ConfirmDelete
          target={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </MessageActionsProvider>
  )
}

// Deliberately a modal rather than an inline "click again to confirm": the
// action bar sits under the pointer, and a second click landing on a button
// that changed meaning is how people delete the wrong message.
function ConfirmDelete({
  target,
  onCancel,
  onConfirm,
}: {
  target: MatrixEvent
  onCancel: () => void
  onConfirm: () => void
}) {
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm delete"
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
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
          padding: 18,
          borderRadius: 12,
          fontFamily: 'var(--tc-ui-font, inherit)',
          color: 'var(--cpd-color-text-primary)',
          background: 'var(--cpd-color-bg-canvas-default)',
          border: '1px solid rgba(128,128,128,0.35)',
          boxShadow: '0 16px 44px rgba(0,0,0,0.55)',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Delete message?</div>
        <div style={{ fontSize: 13, color: 'var(--cpd-color-text-secondary)', marginBottom: 6 }}>
          This removes it for everyone. It cannot be undone.
        </div>
        <div
          style={{
            fontSize: 12,
            padding: '6px 10px',
            marginBottom: 14,
            borderRadius: 6,
            borderLeft: '3px solid rgba(128,128,128,0.5)',
            background: 'var(--cpd-color-bg-subtle-secondary)',
            color: 'var(--cpd-color-text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {eventPreview(target, 90)}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onCancel} style={{ fontSize: 13, padding: '5px 12px' }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            style={{
              fontSize: 13,
              padding: '5px 12px',
              fontWeight: 600,
              color: 'var(--cpd-color-text-critical-primary, #ff6b6b)',
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
