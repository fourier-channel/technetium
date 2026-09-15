// Checks for the composer's panel-level Enter (ui-depth-v1 U6).
//
// The reported bug: a picture attached, Enter pressed, and the file chooser
// opened again instead of the picture being posted -- because the focus was
// still on the attach button. The cases here are mostly about the ways this
// rescue could be WORSE than the bug, since a handler on the whole panel that
// swallowed Enter would break the emoji picker, double-send from the Send
// button, and eat Shift+Enter.
import { panelEnterSends, type PanelEnter } from '../src/ui/composerEnter.ts'

let failures = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

// The reported situation: a picture waiting, focus parked on a button.
const onAttachButton: PanelEnter = {
  key: 'Enter',
  shiftKey: false,
  modified: false,
  pendingAttachments: 1,
  sending: false,
  targetTag: 'BUTTON',
  inSendButton: false,
  inEmojiPicker: false,
}
const at = (over: Partial<PanelEnter>): PanelEnter => ({ ...onAttachButton, ...over })

console.log('\n-- the reported bug --')
{
  check('Enter on the attach button, with a picture waiting, sends',
    panelEnterSends(onAttachButton))
  check('and so does Enter on the panel itself',
    panelEnterSends(at({ targetTag: 'DIV' })))
  check('several pictures waiting is the same case',
    panelEnterSends(at({ pendingAttachments: 4 })))
}

console.log('\n-- narrow: only while a picture is waiting --')
{
  // With an empty tray the ordinary focus rules are right, and Enter on a
  // button is that button's. Turning every Enter in the panel into a send
  // would be a worse bug than the one being fixed.
  check('an empty tray leaves Enter alone', !panelEnterSends(at({ pendingAttachments: 0 })))
  check('a negative count is not a picture', !panelEnterSends(at({ pendingAttachments: -1 })))
  check('a send already in flight does not start another',
    !panelEnterSends(at({ sending: true })))
}

console.log('\n-- fields keep their own Enter --')
{
  // The textarea has its own handler that does exactly this; taking the event
  // here would either double-send or fight the mention popup, which owns Enter
  // while it is open.
  check('the text box is left alone', !panelEnterSends(at({ targetTag: 'TEXTAREA' })))
  check('an input is left alone', !panelEnterSends(at({ targetTag: 'INPUT' })))
  check('a select is left alone', !panelEnterSends(at({ targetTag: 'SELECT' })))
}

console.log('\n-- the two controls that own Enter for themselves --')
{
  check('Send activates itself rather than being sent twice',
    !panelEnterSends(at({ inSendButton: true })))
  check('the emoji picker picks an emoji', !panelEnterSends(at({ inEmojiPicker: true })))
}

console.log('\n-- modifiers --')
{
  check('Shift+Enter is not a send', !panelEnterSends(at({ shiftKey: true })))
  check('a modified Enter belongs to somebody else', !panelEnterSends(at({ modified: true })))
}

console.log('\n-- anything that is not Enter --')
{
  for (const key of ['a', ' ', 'Escape', 'Tab', 'ArrowDown', 'NumpadEnter', '']) {
    check(`${key || '(empty)'} does not send`, !panelEnterSends(at({ key })))
  }
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
