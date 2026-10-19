import { useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { IContent, MatrixEvent, Room } from 'matrix-js-sdk'
import { useClient } from '../client/clientContextValue'
import { isEditableContent } from '../client/editContent'
import { eventPreview } from '../client/eventPreview'
import { usePinnedEvents } from '../client/usePinnedEvents'
import { buildForwardContent, isForwardable } from '../client/forwardContent'
import { RoomPicker } from './RoomPicker'
import { ReplacePicture } from './ReplacePicture'
import { canReplacePicture, replaceEnabled } from '../client/pictureReplace'
import { canStartThreads, mayOfferStartThread } from '../client/threadStart'
import { MessageActionsProvider } from './MessageActionBar'
import { useComposerMode } from './composerMode'
import { ReactTargetContext } from './reactTarget'
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

// `onStartThread` is given only where a thread can be started from: the room
// timeline. The thread panel leaves it out, because threads do not nest.
export function MessageVerbsProvider({ room, children, onStartThread }: { room: Room | null; children: ReactNode; onStartThread?: (roomId: string, rootId: string) => void }) {
  const { client } = useClient()
  const { reply, edit } = useComposerMode()
  const myUserId = client?.getUserId() ?? null
  // Redaction is destructive and irreversible, so it is two-step: the action
  // bar arms it, this dialog confirms it.
  const [pendingDelete, setPendingDelete] = useState<MatrixEvent | null>(null)
  // Which message has the emoji picker open. Owned here so the action bar's
  // React verb and each strip's "+" cannot both open one.
  const [reactTarget, setReactTarget] = useState<string | null>(null)
  // Pinning is room state, so it is power-level gated like any state write.
  const { pinned, canPin, toggle: togglePin } = usePinnedEvents(client, room)
  // The item whose content is being forwarded, while the room picker is open.
  const [forwarding, setForwarding] = useState<{ content: IContent } | null>(null)
  // The picture message being replaced, while its dialog is open.
  const [replacing, setReplacing] = useState<{ event: MatrixEvent; content: IContent } | null>(null)
  // Held until the booru takes creator replacements (client/pictureReplace.ts).
  // Read once per mount, like domain mode: the switch says a reload is needed.
  const [replaceOn] = useState(() => replaceEnabled())
  const roomEncrypted = room?.hasEncryptionStateEvent() ?? false

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
        if (!isActionable(item.kind) || !onStartThread || !room) return null
        if (!mayOfferStartThread(item.event)) return null
        // Starting a thread takes the room's thread level (49 unless the room
        // says otherwise; client/threadStart.ts). The server refuses below it
        // whatever client asks, so the verb is hidden rather than shown-and-
        // failing. Asked here, when the bar is built, not memoised: a
        // promotion then shows on the next hover.
        if (!canStartThreads(room, myUserId)) return null
        const rootId = item.event.getId()!
        return {
          id: 'start-thread',
          label: 'Start thread',
          icon: '\u2937', // arrow curving off to the right: a branch
          // Opens the thread panel on this message; the composer's first reply
          // there is what creates the thread.
          onSelect: () => onStartThread(room.roomId, rootId),
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
        // Your own picture, given a new file: an edit Neru-chan carries to the
        // booru post (client/pictureReplace.ts). Single pictures only -- a
        // gallery row is several messages.
        if (!replaceOn || item.kind !== 'message') return null
        if (!canReplacePicture({ content: item.content, sender: item.event.getSender(), me: myUserId, eventId: item.id, roomEncrypted })) return null
        return {
          id: 'replace-picture',
          label: 'Replace picture',
          icon: '⇄',
          onSelect: () => setReplacing({ event: item.event, content: item.content }),
        }
      },
      (item) => {
        if (!isActionable(item.kind)) return null
        // A local echo has no server-side id yet, so nothing can annotate it.
        if (item.id.startsWith('~')) return null
        return {
          id: 'react',
          label: 'React',
          icon: '☺', // white smiling face
          onSelect: () => setReactTarget(item.id),
        }
      },
      (item) => {
        if (!isActionable(item.kind)) return null
        if (!isForwardable(item.content)) return null
        return {
          id: 'forward',
          label: 'Forward',
          icon: '➦',
          onSelect: () => setForwarding({ content: item.content }),
        }
      },
      (item) => {
        if (!isActionable(item.kind)) return null
        if (!canPin) return null
        if (item.id.startsWith('~')) return null
        const isPinned = pinned.includes(item.id)
        return {
          id: 'pin',
          label: isPinned ? 'Unpin' : 'Pin',
          icon: isPinned ? '📌' : '📍',
          onSelect: () => void togglePin(item.id),
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
    [reply, edit, myUserId, canRedactOthers, canPin, pinned, togglePin, replaceOn, roomEncrypted, onStartThread, room],
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

  const reactApi = useMemo(
    () => ({ target: reactTarget, setTarget: setReactTarget }),
    [reactTarget],
  )

  return (
    <MessageActionsProvider builders={builders}>
      <ReactTargetContext.Provider value={reactApi}>{children}</ReactTargetContext.Provider>
      {forwarding && (
        <RoomPicker
          client={client}
          title="Forward to..."
          confirmLabel="Forwarding"
          excludeRoomId={room?.roomId}
          onPick={(target) => {
            const content = buildForwardContent(forwarding.content)
            setForwarding(null)
            if (!client) return
            // threadId null: a forward starts fresh in the target room.
            void client
              .sendMessage(
                target.roomId,
                null,
                content as unknown as Parameters<typeof client.sendMessage>[2],
              )
              .catch((err) => console.error('Forward failed:', err))
          }}
          onClose={() => setForwarding(null)}
        />
      )}
      {replacing && client && (
        <ReplacePicture
          client={client}
          target={replacing.event}
          current={replacing.content}
          onClose={() => setReplacing(null)}
        />
      )}
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
