import { useMemo, type ReactNode } from 'react'
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
  const { reply } = useComposerMode()

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
    ],
    [reply],
  )

  return <MessageActionsProvider builders={builders}>{children}</MessageActionsProvider>
}
