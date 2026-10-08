import type { RoomMember } from 'matrix-js-sdk'
import { ROOM_MENTION } from '../client/roomMention'

// W2.9 -- the `@` autocomplete list.
//
// Purely presentational: the composer owns the query, the selection index and
// every key binding, because the keys that drive this popup (Enter, Tab,
// arrows, Escape) all belong to the textarea and must be intercepted there
// before they send a message or move the caret.
//
// An entry is a member or @room (launch-polish L28). @room is offered only to
// someone whose level may notify the room; anyone else sees `note` instead --
// the reason, rather than an entry that silently does nothing.

export type MentionEntry = { kind: 'member'; member: RoomMember } | { kind: 'room' }

export function MentionPicker({
  matches,
  activeIndex,
  onPick,
  note = null,
}: {
  matches: MentionEntry[]
  activeIndex: number
  onPick: (entry: MentionEntry) => void
  note?: string | null
}) {
  if (matches.length === 0 && !note) return null

  return (
    <div className="tc-mention-picker" role="listbox" aria-label="Mention a member">
      {matches.map((entry, i) => (
        <button
          key={entry.kind === 'room' ? ROOM_MENTION : entry.member.userId}
          type="button"
          role="option"
          aria-selected={i === activeIndex}
          data-active={i === activeIndex ? 'true' : undefined}
          data-room={entry.kind === 'room' ? 'true' : undefined}
          className="tc-mention-item"
          // Mouse DOWN, not click: a click would first blur the textarea and
          // lose the caret position the insert depends on.
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(entry)
          }}
        >
          {entry.kind === 'room' ? (
            <>
              <span className="tc-mention-name">{ROOM_MENTION}</span>
              <span className="tc-mention-id">Notify everyone in this room</span>
            </>
          ) : (
            <>
              <span className="tc-mention-name">{entry.member.name || entry.member.userId}</span>
              <span className="tc-mention-id">{entry.member.userId}</span>
            </>
          )}
        </button>
      ))}
      {note && (
        <div className="tc-mention-note" role="note">
          <span className="tc-mention-name">{ROOM_MENTION}</span>
          <span className="tc-mention-id">{note}</span>
        </div>
      )}
    </div>
  )
}
