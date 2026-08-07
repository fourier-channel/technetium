import type { RoomMember } from 'matrix-js-sdk'

// W2.9 -- the `@` autocomplete list.
//
// Purely presentational: the composer owns the query, the selection index and
// every key binding, because the keys that drive this popup (Enter, Tab,
// arrows, Escape) all belong to the textarea and must be intercepted there
// before they send a message or move the caret.

export function MentionPicker({
  matches,
  activeIndex,
  onPick,
}: {
  matches: RoomMember[]
  activeIndex: number
  onPick: (member: RoomMember) => void
}) {
  if (matches.length === 0) return null

  return (
    <div className="tc-mention-picker" role="listbox" aria-label="Mention a member">
      {matches.map((m, i) => (
        <button
          key={m.userId}
          type="button"
          role="option"
          aria-selected={i === activeIndex}
          data-active={i === activeIndex ? 'true' : undefined}
          className="tc-mention-item"
          // Mouse DOWN, not click: a click would first blur the textarea and
          // lose the caret position the insert depends on.
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(m)
          }}
        >
          <span className="tc-mention-name">{m.name || m.userId}</span>
          <span className="tc-mention-id">{m.userId}</span>
        </button>
      ))}
    </div>
  )
}
