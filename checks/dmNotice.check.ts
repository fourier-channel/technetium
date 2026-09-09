// Checks for the notice a newly created DM shows about itself.
//
// The gap this closes: dmEncryptionNotice existed from E4 and had no caller,
// so a DM created in the clear was indistinguishable from an encrypted one.
import {
  dismissDmNotice,
  dmNoticeFor,
  recordDmNotice,
  resetDmNoticesForTest,
  subscribeDmNotice,
} from '../src/client/dmNotice.ts'
import { dmEncryptionNotice, type DmEncryptionDecision } from '../src/client/dmEncryption.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const ALL: DmEncryptionDecision[] =
  ['encrypt', 'plaintext-no-crypto', 'plaintext-recipient-cannot', 'plaintext-unknown-recipient']

console.log('== every outcome is reportable')
for (const d of ALL) {
  resetDmNoticesForTest()
  recordDmNotice('!r:example.org', d)
  check(`${d} is recorded and readable`, dmNoticeFor('!r:example.org') === d)
  // The encrypted case gets a notice TOO. Saying nothing when it worked trains
  // people to read silence as success, which makes the silence that means
  // failure unreadable.
  check(`${d} has something to say`, dmEncryptionNotice(d).trim().length > 20)
}

console.log('\n== an existing room made no decision')
resetDmNoticesForTest()
recordDmNotice('!existing:example.org', null)
check('null records nothing -- startDm returns it for a room that already existed',
  dmNoticeFor('!existing:example.org') === null)

console.log('\n== scope')
resetDmNoticesForTest()
recordDmNotice('!a:example.org', 'encrypt')
check('a room with no notice reads null', dmNoticeFor('!b:example.org') === null)
check('notices do not leak between rooms', dmNoticeFor('!a:example.org') === 'encrypt')

console.log('\n== dismissal')
resetDmNoticesForTest()
recordDmNotice('!a:example.org', 'plaintext-recipient-cannot')
dismissDmNotice('!a:example.org')
check('a dismissed notice stays dismissed', dmNoticeFor('!a:example.org') === null)
check('dismissing an absent notice is harmless',
  (() => { dismissDmNotice('!nothing:example.org'); return true })())

console.log('\n== subscribers')
resetDmNoticesForTest()
{
  let fired = 0
  const unsub = subscribeDmNotice(() => { fired++ })
  recordDmNotice('!a:example.org', 'encrypt')
  check('recording notifies subscribers', fired === 1, { fired })
  dismissDmNotice('!a:example.org')
  check('dismissing notifies subscribers', fired === 2, { fired })
  recordDmNotice('!a:example.org', null)
  check('a null decision notifies nobody, because nothing changed', fired === 2, { fired })
  unsub()
  recordDmNotice('!c:example.org', 'encrypt')
  check('unsubscribing stops the notifications', fired === 2, { fired })
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
