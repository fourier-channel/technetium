import { useMemo, type ReactNode } from 'react'
import { useClient } from '../client/ClientContext'
import { isEditableContent } from '../client/editContent'
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

export function MessageVerbsProvider({ children }: { children: ReactNode }) {
  const { client } = useClient()
  const { reply, edit } = useComposerMode()
  const myUserId = client?.getUserId() ?? null

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
    ],
    [reply, edit, myUserId],
  )

  return <MessageActionsProvider builders={builders}>{children}</MessageActionsProvider>
}
