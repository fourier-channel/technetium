import type { MatrixClient, Room } from 'matrix-js-sdk'
import { useTypingMembers } from '../client/useTyping'

// W2.L4 -- the typing line, rendered BETWEEN the timeline and the composer
// rather than inside the message flow. In the flow it would push messages
// around every time someone started or stopped typing, which is the
// no-forced-reflow rule: a transient status must not move the thing people
// are reading.
//
// The bar therefore reserves its own height permanently and simply empties
// when nobody is typing.

// Beyond this, name them by count instead of listing them.
const MAX_NAMED = 3

function phrase(names: string[]): string {
  if (names.length === 1) return `${names[0]} is typing...`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`
  if (names.length <= MAX_NAMED) {
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are typing...`
  }
  return `${names.length} people are typing...`
}

export function TypingBar({ client, room }: { client: MatrixClient | null; room: Room | null }) {
  const typing = useTypingMembers(client, room)
  const names = typing.map((m) => m.name || m.userId)

  return (
    <div className="tc-typing-bar" aria-live="polite" aria-atomic="true">
      {names.length > 0 ? phrase(names) : ''}
    </div>
  )
}
