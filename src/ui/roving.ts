import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

// ---------------------------------------------------------------------------
// Roving tabindex: a group of buttons that costs ONE tab stop, with arrow keys
// moving inside it.
//
// The timeline renders dozens of rows, each carrying an action bar and a
// reactions strip. If every button were tabbable, reaching the composer from
// the top of the timeline would mean hundreds of tab stops. This is the
// standard ARIA composite-widget treatment, factored out so the action bar and
// the reactions strip cannot drift apart.
//
// No ref is involved. The keydown handler is attached to the container, so
// e.currentTarget IS the container -- and returning a ref from a hook trips
// the React Compiler's refs-during-render rule the moment a caller spreads it
// (G-tc01).
// ---------------------------------------------------------------------------

export interface Roving {
  // Index whose button carries tabIndex 0. Clamped, so a shrinking list (a
  // reaction losing its last sender) cannot strand focus past the end.
  activeIndex: number
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void
  itemProps: (i: number) => { tabIndex: number; onFocus: () => void }
}

export function useRoving(count: number): Roving {
  const [active, setActive] = useState(0)
  const activeIndex = count > 0 ? Math.min(active, count - 1) : 0

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    const container = e.currentTarget
    const focusAt = (i: number) => {
      if (count === 0) return
      const next = (i + count) % count
      setActive(next)
      container.querySelectorAll('button')[next]?.focus()
    }

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault()
        focusAt(activeIndex + 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault()
        focusAt(activeIndex - 1)
        break
      case 'Home':
        e.preventDefault()
        focusAt(0)
        break
      case 'End':
        e.preventDefault()
        focusAt(count - 1)
        break
    }
  }

  return {
    activeIndex,
    onKeyDown,
    itemProps: (i: number) => ({
      tabIndex: i === activeIndex ? 0 : -1,
      onFocus: () => setActive(i),
    }),
  }
}
