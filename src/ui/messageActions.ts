import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { TimelineItem } from '../client/useTimeline'

// ---------------------------------------------------------------------------
// S2 -- the message action registry.
//
// A slot REGISTRY, not a fixed list of buttons. Wave 2's verbs (reply, edit,
// delete, react, pin, forward) each contribute a builder; the Row renders
// whatever the builders yield for the item under the pointer and never learns
// what a verb is. That is what keeps Row from accumulating a prop per verb,
// and it means the thread panel inherits every verb for free -- it shares the
// same Row.
//
// Split from MessageActionBar.tsx so neither file mixes component and
// non-component exports (react-refresh/only-export-components).
// ---------------------------------------------------------------------------

export interface MessageAction {
  // Stable identity, also the React key. e.g. 'reply', 'edit'.
  id: string
  // Accessible name. Rendered as the tooltip and read by screen readers.
  label: string
  // Compact visual -- a glyph or a small node. Kept to one grapheme.
  icon: ReactNode
  onSelect: () => void
  // Renders in the critical color (delete).
  danger?: boolean
}

// Returns an action for this item, or null when the verb does not apply --
// editing someone else's message, pinning without the power level, reacting to
// a redacted event.
export type MessageActionBuilder = (item: TimelineItem) => MessageAction | null

export const MessageActionsContext = createContext<MessageActionBuilder[]>([])

// Resolve the registry down to the actions that actually apply to one item.
export function useMessageActions(item: TimelineItem): MessageAction[] {
  const builders = useContext(MessageActionsContext)
  return useMemo(() => {
    const out: MessageAction[] = []
    for (const build of builders) {
      const action = build(item)
      if (action) out.push(action)
    }
    return out
  }, [builders, item])
}
