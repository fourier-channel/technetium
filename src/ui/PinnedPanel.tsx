import { useEffect, useMemo } from 'react'
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk'
import { eventPreview } from '../client/eventPreview'
import { useJump } from './jumpToEvent'

// W2.7 -- the pinned-message list, opened from the timeline header.
//
// Pinned state carries only event IDs, so an id whose event is outside the
// loaded window cannot be previewed. Rather than hiding those (which would
// make the count lie) or blocking on a fetch, each row resolves what it can
// and says so honestly; clicking still works, because the jump paginates.

interface PinnedRow {
  eventId: string
  event: MatrixEvent | null
}

export function PinnedPanel({
  client,
  room,
  pinned,
  canPin,
  onUnpin,
  onClose,
}: {
  client: MatrixClient | null
  room: Room | null
  pinned: string[]
  canPin: boolean
  onUnpin: (eventId: string) => void
  onClose: () => void
}) {
  const { jump } = useJump()

  // Derived from props, so it is computed, not stored. Holding it in state
  // would mean an effect to keep it in sync -- and a setState in an effect
  // body is what G-tc01 forbids.
  //
  // findEventById only sees what is already LOADED, deliberately: opening the
  // panel should not fire a fetch per pin in a room with fifty of them. Newest
  // first, since a pinned list is read top-down for the most recent notice.
  const rows: PinnedRow[] = useMemo(
    () =>
      room
        ? [...pinned].reverse().map((eventId) => ({
            eventId,
            event: room.findEventById(eventId) ?? null,
          }))
        : [],
    [room, pinned],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="tc-pinned-panel" role="dialog" aria-label="Pinned messages">
      <div className="tc-pinned-header">
        <strong>Pinned messages</strong>
        <button type="button" onClick={onClose} aria-label="Close pinned messages">
          Close
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="tc-pinned-empty">Nothing pinned in this room.</div>
      ) : (
        <ul className="tc-pinned-list">
          {rows.map((row) => {
            const senderId = row.event?.getSender() ?? null
            const name = senderId ? room?.getMember(senderId)?.name || senderId : null
            return (
              <li key={row.eventId} className="tc-pinned-item">
                <button
                  type="button"
                  className="tc-pinned-jump"
                  onClick={() => {
                    onClose()
                    void jump(row.eventId)
                  }}
                  title="Jump to this message"
                >
                  <span className="tc-pinned-sender">{name ?? 'Unknown sender'}</span>
                  <span className="tc-pinned-preview">
                    {row.event ? eventPreview(row.event, 100) : 'Not loaded -- click to find it'}
                  </span>
                </button>
                {canPin && (
                  <button
                    type="button"
                    className="tc-pinned-unpin"
                    onClick={() => onUnpin(row.eventId)}
                    title="Unpin"
                    aria-label="Unpin this message"
                  >
                    {'×'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {client === null && <div className="tc-pinned-empty">Not connected.</div>}
    </div>
  )
}
