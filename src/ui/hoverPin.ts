// A popup behind a control that a mouse previews on hover and a click or tap
// pins: the beta strip's notice, and a room's full topic (operator,
// 2026-10-10). ONE rule for both, here, and ONE wiring of it, useHoverPin.
//
// A MOUSE previews it on hover. Only a mouse: a tap fires pointerenter too, and
// a preview opened by the same tap whose click then toggles would close at
// once. A click (or tap) pins it open, and the next one closes it. A press
// outside, or Escape, closes it however it was opened (AnchoredPopup's
// onClose). Leaving with the mouse closes a preview and never a pin.

export type HoverPinState = 'closed' | 'hover' | 'pinned'

export type HoverPinEvent =
  | { kind: 'enter' | 'leave'; pointerType: string }
  | { kind: 'click' }
  | { kind: 'dismiss' }

export function nextHoverPin(state: HoverPinState, event: HoverPinEvent): HoverPinState {
  switch (event.kind) {
    case 'enter':
      return event.pointerType === 'mouse' && state === 'closed' ? 'hover' : state
    case 'leave':
      return event.pointerType === 'mouse' && state === 'hover' ? 'closed' : state
    case 'click':
      return state === 'pinned' ? 'closed' : 'pinned'
    case 'dismiss':
      return 'closed'
  }
}
