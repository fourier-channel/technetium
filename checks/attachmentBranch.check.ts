// The plaintext attachment path must be untouched by encryption.
//
// Most rooms on this server are NOT encrypted, so the encrypted-attachment work
// of 2026-09-09 sits directly in the path every ordinary image upload takes.
// The branch is what keeps that safe, and these assert its shape.
//
// WHAT THIS CANNOT SEE: it reads source. It proves the branch exists, is keyed
// on the room's own encryption state, and emits `file` XOR `url`. It does NOT
// prove a plaintext upload still renders.
//
// The ENCRYPTED path was proven with a real 64x64 PNG through a real DM. The
// plaintext equivalent was attempted three ways on 2026-09-09 and reached none
// of them, which is worth writing down so nobody spends the hour again:
//
//   - the test account's non-DM rooms do not appear in the nav at all, because
//     the tree is built from SPACES and those rooms are in none;
//   - a room forced into m.direct as a DM WITH YOURSELF is filtered out of the
//     DM list too -- it has no counterpart user to name or draw;
//   - and the only reachable DMs are the encrypted one, a bridge bot (posting a
//     test image at it would put the image on the booru), and chanbooru.
//
// So the gap is a property of the test accounts, not of the code. The branch
// below is why it is a small risk rather than an untested one: when the room is
// not encrypted, the file, the upload options and the emitted `{url}` are
// identical to what shipped before. Say so rather than implying coverage that
// does not exist.
import { readFileSync } from 'node:fs'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const composer = readFileSync('src/ui/Composer.tsx', 'utf8')
const timeline = readFileSync('src/ui/Timeline.tsx', 'utf8')
// Since 2026-10-01 the upload itself lives in client/attachmentUpload.ts, so a
// retry can reuse what already landed; the composer only decides and sends.
// checks/attachmentUpload.check.ts drives that module for real -- these keep
// the shape assertions pointed at where the code now is.
const upload = readFileSync('src/client/attachmentUpload.ts', 'utf8')

console.log('== the upload branch')
check('encryption is decided by the ROOM, not by a setting or a guess',
  /encrypt: room\.hasEncryptionStateEvent\(\)/.test(composer))
check('the plaintext default is the untouched file',
  /io\.uploadContent\(file, \{ name: file\.name, type: file\.type \}\)/.test(upload))
check('encryption happens BEFORE the upload',
  upload.indexOf('encryptAttachment(') < upload.indexOf('io.uploadContent(') &&
  upload.indexOf('encryptAttachment(') > 0)
// The filename reaches the server in the clear even when the bytes do not.
check('an encrypted upload does not publish the real filename',
  /name: 'encrypted',\s*type: 'application\/octet-stream'/.test(upload))

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
