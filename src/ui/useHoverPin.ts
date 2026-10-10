import { useRef, useState, type PointerEvent, type RefObject } from 'react'
import { nextHoverPin, type HoverPinEvent, type HoverPinState } from './hoverPin'

// The wiring of a hover-pin popup (hoverPin.ts says the rule): spread
// `anchor` on the control and `popup` on its AnchoredPopup, and render the
// popup while `open`.
//
// AnchoredPopup unfurls OVER its control, so the instant a hover preview opens
// the mouse is over the popup, not the control. Hovering either counts, and
// leaving waits HOVER_GRACE_MS before it asks whether the pointer is over
// either one, or the preview would close and reopen. A hover preview takes no
// focus -- a mouse crossing the header must not pull the caret out of the
// composer -- and a pin remounts the popup (`popupKey`) with focus, for a keyboard
// reader. `popupClass` is the popup's own class, which is how the grace asks
// whether the pointer is over it.

const HOVER_GRACE_MS = 150

export function useHoverPin(anchorRef: RefObject<HTMLElement | null>, popupClass: string) {
  const [state, setState] = useState<HoverPinState>('closed')
  const leaving = useRef<number | undefined>(undefined)
  const send = (e: HoverPinEvent) => setState((s) => nextHoverPin(s, e))
  const enter = (e: PointerEvent) => {
    window.clearTimeout(leaving.current)
    send({ kind: 'enter', pointerType: e.pointerType })
  }
  const leave = (e: PointerEvent) => {
    const pointerType = e.pointerType
    window.clearTimeout(leaving.current)
    leaving.current = window.setTimeout(() => {
      const still = anchorRef.current?.matches(':hover') || document.querySelector(`.${popupClass}:hover`) !== null
      if (!still) send({ kind: 'leave', pointerType })
    }, HOVER_GRACE_MS)
  }
  return {
    open: state !== 'closed',
    anchor: {
      'aria-expanded': state !== 'closed',
      onPointerEnter: enter,
      onPointerLeave: leave,
      onClick: () => send({ kind: 'click' }),
    },
    // Not inside `popup`: React refuses a key spread from an object.
    popupKey: state,
    popup: {
      className: popupClass,
      takeFocus: state === 'pinned',
      onPointerEnter: enter,
      onPointerLeave: leave,
      onClose: () => send({ kind: 'dismiss' }),
    },
  }
}
