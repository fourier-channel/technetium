// What the beta strip's notice does with a pointer. The strip is one centred
// title; the notice behind it is a popup, so it costs the header one line on
// every screen instead of four on a phone.
//
// A MOUSE previews it on hover. Only a mouse: a tap fires pointerenter too, and
// a preview opened by the same tap whose click then toggles would close at
// once. A click (or tap) pins it open, and the next one closes it. A press
// outside, or Escape, closes it however it was opened (AnchoredPopup's
// onClose). Leaving with the mouse closes a preview and never a pin.

export type NoticeState = 'closed' | 'hover' | 'pinned'

export type NoticeEvent =
  | { kind: 'enter' | 'leave'; pointerType: string }
  | { kind: 'click' }
  | { kind: 'dismiss' }

export function nextNotice(state: NoticeState, event: NoticeEvent): NoticeState {
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
