// ---------------------------------------------------------------------------
// Does this Enter, pressed somewhere in the composer but NOT in the text box,
// send the message? (ui-depth-v1 U6)
//
// The bug this exists for: attaching a picture happens from a button, and the
// browser leaves the focus on that button when the file chooser closes. Enter
// then re-fired the button and opened the chooser again -- "hitting enter with
// an image uploaded opens it instead of posting". The textarea's own Enter
// handler was never reached, because the textarea never had the focus.
//
// Putting the caret in the composer when a picture lands fixes the reported
// case. This is the half that does not depend on guessing where the browser
// left the focus, and it is separated out here because "which keystroke sends"
// is a rule with edges, and a rule with edges belongs somewhere a check can
// reach it rather than inside a DOM handler (O-tp9).
//
// It is deliberately NARROW. It only ever fires while a picture is WAITING to
// be posted: with an empty tray, Enter on a button is the button's, and turning
// every stray Enter in the panel into a send would be a worse bug than the one
// being fixed.
// ---------------------------------------------------------------------------

export interface PanelEnter {
  key: string
  shiftKey: boolean
  // Any of ctrl / meta / alt. A modified Enter is somebody's shortcut, not ours.
  modified: boolean
  // How many pictures are sitting in the tray.
  pendingAttachments: number
  // A send already in flight.
  sending: boolean
  // The tag name of the element the keystroke landed on, upper case as the DOM
  // reports it.
  targetTag: string
  // The keystroke landed on (or inside) the Send button, which activates itself.
  inSendButton: boolean
  // The keystroke landed inside the emoji picker, where Enter picks an emoji.
  inEmojiPicker: boolean
}

export function panelEnterSends(e: PanelEnter): boolean {
  if (e.key !== 'Enter') return false
  // Shift+Enter is a newline in the box and nothing anywhere else.
  if (e.shiftKey || e.modified) return false
  // Nothing to rescue: with an empty tray the ordinary focus rules are right.
  if (e.pendingAttachments <= 0) return false
  if (e.sending) return false
  // A field is somewhere you are typing. The textarea has its own Enter, which
  // does the same thing; anything else with a caret in it is not ours to take.
  if (e.targetTag === 'TEXTAREA' || e.targetTag === 'INPUT' || e.targetTag === 'SELECT') return false
  // Let Send be Send, or the message goes twice.
  if (e.inSendButton) return false
  if (e.inEmojiPicker) return false
  return true
}
