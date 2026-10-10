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
//
// A preview opens only after the mouse has RESTED HOVER_OPEN_MS on the
// control. Opening on first contact covered whatever else was there: the
// topic line runs under the Direct message and Threads tabs that hang from
// the chat's top border, so a mouse crossing the topic on its way to a tab
// opened the topic over the tab and the click landed on the topic (operator,
// 2026-10-10: "the handles for the DM window and the thread list are
// non-functional"). A tap or a click pins at once, as before.

const HOVER_OPEN_MS = 400
const HOVER_GRACE_MS = 150

export function useHoverPin(anchorRef: RefObject<HTMLElement | null>, popupClass: string) {
  const [state, setState] = useState<HoverPinState>('closed')
  const leaving = useRef<number | undefined>(undefined)
  const opening = useRef<number | undefined>(undefined)
  const send = (e: HoverPinEvent) => setState((s) => nextHoverPin(s, e))
  const enter = (e: PointerEvent) => {
    const pointerType = e.pointerType
    window.clearTimeout(leaving.current)
    window.clearTimeout(opening.current)
    // Already open (the pointer moved between control and popup): it stays.
    // Closed: it opens only if the mouse is still resting here after the dwell.
    if (state !== 'closed') send({ kind: 'enter', pointerType })
    else opening.current = window.setTimeout(() => send({ kind: 'enter', pointerType }), HOVER_OPEN_MS)
  }
  const leave = (e: PointerEvent) => {
    const pointerType = e.pointerType
    window.clearTimeout(opening.current)
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
      onClick: () => {
        window.clearTimeout(opening.current)
        send({ kind: 'click' })
      },
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
