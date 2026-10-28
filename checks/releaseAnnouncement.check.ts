// Fourier-chan's release announcement: notes come from Release-note trailers,
// once each, in order; none means a plain "tuning" line; an address is refused.
//
// WHAT THIS CANNOT SEE: the room. deploy.sh sends the text through her hub
// socket, and the hub's own say is what reaches Matrix.
import { addressIn, announcement, releaseNotes } from '../tools/release/announcement.ts'
import { BUG_REPORT } from '../src/client/bugReport.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const log = [
  'header: one line\n\nBody.\n\nRelease-note: The beta banner is one line now.\nCo-Authored-By: x',
  'hydrate: pointer\n\nNo note here.',
  'topic: editable\n\nRelease-note:   Tap a topic to read all of it.  \nRelease-note: Moderators can edit it in place.',
  'again\n\nRelease-note: The beta banner is one line now.',
].join('\n')
const notes = releaseNotes(log)
check('trailers are collected in order, trimmed, once each',
  JSON.stringify(notes) === JSON.stringify(['The beta banner is one line now.', 'Tap a topic to read all of it.', 'Moderators can edit it in place.']), notes)
check('a body line that merely mentions the word is not a note', releaseNotes('see the Release-note: rule above').length === 0)

const text = announcement('2026.10.13', 'abc1234', notes)
check('it opens with the version', text.startsWith('Signal found! Technetium 2026.10.13 is live.'), text)
check('it lists every note', notes.every((n) => text.includes(`- ${n}`)))
check('it names the build', text.includes('(build abc1234)'))
check('with no notes it says so instead of an empty list',
  /tuning under the hood/.test(announcement('v', 'c', [])) && !/What's new/.test(announcement('v', 'c', [])))
check('it is ASCII', /^[\x00-\x7f]*$/.test(text))
check('a problem goes to the bug intake, not this room (tc.149)',
  text.includes(`Send ${BUG_REPORT.command} `) && text.includes(` in ${BUG_REPORT.room} or in a DM with me.`) &&
  !/this room/.test(text), text)

check('a URL is refused', addressIn(['See https://example.test']) !== null)
check('a host is refused', addressIn(['now on tc.41chan.net']) !== null)
check('an IP is refused', addressIn(['moved to 10.0.0.1']) !== null)
check('plain notes pass', addressIn(notes) === null)
check('the template itself names no address', addressIn([text]) === null)

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
