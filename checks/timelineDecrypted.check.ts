// The timeline must repaint when decryption finishes.
//
// An encrypted message enters the timeline as ciphertext and is decrypted
// asynchronously afterwards. Nothing fires a Timeline event when the plaintext
// lands, so a view built at ciphertext time stays that way. Measured on
// production 2026-09-09: a DM held the other party's messages and displayed
// NOTHING -- not even a padlock -- while the same room, reloaded, rendered them
// fine. No file in this codebase listened for MatrixEventEvent.Decrypted.
//
// WHAT THIS CHECK CANNOT SEE. It reads the source. It proves the listener is
// registered, filtered by room, and removed on cleanup; it does NOT prove the
// SDK emits the event or that React repaints. Only a live encrypted exchange
// shows that, which is why this landed with one. Treat it as a guard against
// the listener being dropped, not as evidence the feature works.
import { readFileSync } from 'node:fs'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const src = readFileSync('src/client/useTimeline.ts', 'utf8')

check('MatrixEventEvent is imported', /MatrixEventEvent/.test(src))
check('the timeline subscribes to Decrypted',
  /client\.on\(\s*MatrixEventEvent\.Decrypted/.test(src))
check('and unsubscribes, so a room switch does not leak a listener',
  /client\.off\(\s*MatrixEventEvent\.Decrypted/.test(src))

// Scoped to the room being viewed. An unfiltered handler would repaint the open
// room every time any OTHER room decrypted anything -- which on an account in
// many encrypted rooms is a repaint storm, not a feature.
const handler = src.slice(src.indexOf('const onDecrypted'), src.indexOf('const onAccountData'))
check('the handler is scoped to the room on screen',
  /roomRef\.current\?\.roomId/.test(handler), { handler: handler.slice(0, 160) })
check('it schedules the same batched refresh as every other listener',
  /scheduleRefresh\(\)/.test(handler))

// The classifier has to keep an in-flight event visible, or a message would
// vanish between arriving and decrypting.
check('an event still decrypting is classified, not dropped',
  /isBeingDecrypted\(\)/.test(src))

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
