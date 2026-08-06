import { useRef, useState, type ReactNode } from 'react'
import {
  MessageActionsContext,
  type MessageAction,
  type MessageActionBuilder,
} from './messageActions'

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

// An ARIA toolbar: ONE tab stop for the whole bar, arrow keys between buttons
// (roving tabindex). Without this, tabbing through a timeline of 60 rows would
// mean stepping over several hundred buttons to reach the composer.
export function MessageActionBar({ actions }: { actions: MessageAction[] }) {
  const [active, setActive] = useState(0)
  const barRef = useRef<HTMLDivElement>(null)

  if (actions.length === 0) return null
  // A rebuilt action list can leave `active` past the end.
  const activeIndex = Math.min(active, actions.length - 1)

  const focusAt = (i: number) => {
    const next = (i + actions.length) % actions.length
    setActive(next)
    barRef.current?.querySelectorAll('button')[next]?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      focusAt(activeIndex + 1)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focusAt(activeIndex - 1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      focusAt(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      focusAt(actions.length - 1)
    }
  }

  return (
    <div
      ref={barRef}
      className="tc-row-actions"
      role="toolbar"
      aria-label="Message actions"
      onKeyDown={onKeyDown}
    >
      {actions.map((a, i) => (
        <button
          key={a.id}
          type="button"
          className="tc-row-action"
          title={a.label}
          aria-label={a.label}
          tabIndex={i === activeIndex ? 0 : -1}
          onFocus={() => setActive(i)}
          onClick={a.onSelect}
          data-danger={a.danger ? 'true' : undefined}
        >
          {a.icon}
        </button>
      ))}
    </div>
  )
}
