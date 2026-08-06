import { type ReactNode } from 'react'
import {
  MessageActionsContext,
  type MessageAction,
  type MessageActionBuilder,
} from './messageActions'
import { useRoving } from './roving'

// ---------------------------------------------------------------------------
// S2 -- the message action bar shell. See messageActions.ts for the registry.
//
// Visibility is CSS, deliberately: driving row hover from React state would
// re-render a row on every pointer crossing, and Row is not memoized. The bar
// stays in the DOM (opacity, not display) so :focus-within can reveal it for
// keyboard users. Styles live in index.css under `.tc-row-actions`.
// ---------------------------------------------------------------------------

export function MessageActionsProvider({
  builders,
  children,
}: {
  builders: MessageActionBuilder[]
  children: ReactNode
}) {
  return (
    <MessageActionsContext.Provider value={builders}>{children}</MessageActionsContext.Provider>
  )
}

// An ARIA toolbar: ONE tab stop for the whole bar, arrow keys between buttons.
export function MessageActionBar({ actions }: { actions: MessageAction[] }) {
  const roving = useRoving(actions.length)

  if (actions.length === 0) return null

  return (
    <div
      className="tc-row-actions"
      role="toolbar"
      aria-label="Message actions"
      onKeyDown={roving.onKeyDown}
    >
      {actions.map((a, i) => (
        <button
          key={a.id}
          type="button"
          className="tc-row-action"
          title={a.label}
          aria-label={a.label}
          onClick={a.onSelect}
          data-danger={a.danger ? 'true' : undefined}
          {...roving.itemProps(i)}
        >
          {a.icon}
        </button>
      ))}
    </div>
  )
}
