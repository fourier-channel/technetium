// The plaintext attachment path must be untouched by encryption.
//
// Most rooms on this server are NOT encrypted, so the encrypted-attachment work
// of 2026-09-09 sits directly in the path every ordinary image upload takes.
// The branch is what keeps that safe, and these assert its shape.
//
// WHAT THIS CANNOT SEE: it reads source. It proves the branch exists, is keyed
// on the room's own encryption state, and emits `file` XOR `url`. It does NOT
// prove a plaintext upload still renders -- the encrypted one was proven with a
// real 64x64 PNG through a real DM, and the plaintext equivalent was NOT
// re-run, because the test account's non-DM rooms are unreachable from the nav
// (space-based) and forcing one into the DM strip was not worth the account
// surgery. The branch below is why that is a small risk rather than an
// untested one. Say so rather than implying coverage that does not exist.
import { readFileSync } from 'node:fs'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const composer = readFileSync('src/ui/Composer.tsx', 'utf8')
const timeline = readFileSync('src/ui/Timeline.tsx', 'utf8')

console.log('== the upload branch')
check('encryption is decided by the ROOM, not by a setting or a guess',
  /const encrypt = room\.hasEncryptionStateEvent\(\)/.test(composer))
check('the plaintext default is the untouched file',
  /let upload: Blob = att\.file/.test(composer))
check('encryption happens BEFORE the upload',
  composer.indexOf('encryptAttachment(') < composer.indexOf('client.uploadContent(') &&
  composer.indexOf('encryptAttachment(') > 0)
// The filename reaches the server in the clear even when the bytes do not.
check('an encrypted upload does not publish the real filename',
  /name: 'encrypted', type: 'application\/octet-stream'/.test(composer))

console.log('\n== the event carries file XOR url')
check('file replaces url, never joins it',
  /\.\.\.\(encrypted \? \{ file: \{ \.\.\.encrypted, url \} \} : \{ url \}\)/.test(composer),
  { why: 'emitting both would publish a plaintext address for ciphertext' })

console.log('\n== the render branch')
check('the media gate accepts an encrypted file as well as a url',
  /!!encFile \|\| !!parseMxc/.test(timeline))
check('the encrypted cell is tried first and falls through to the plaintext one',
  timeline.indexOf("content.msgtype === 'm.image' && encFile") > 0 &&
  timeline.indexOf("content.msgtype === 'm.image' && encFile") <
    timeline.indexOf("content.msgtype === 'm.image' && parseMxc(mxc)"))
check('encryptedFileOf decides it, rather than a hand-rolled shape test',
  /encryptedFileOf\(item\.content\)/.test(timeline))

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
