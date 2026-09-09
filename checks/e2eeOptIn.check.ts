// Checks for the runtime encryption switch.
//
// This switch can only ever turn encryption ON. That asymmetry is the whole
// safety property: a bug that fails the wrong way here would leave a user
// believing a conversation is private when it is not, so every path that
// cannot be proven is required to answer "off".
import {
  applyOptIn,
  needsReload,
  passphraseAccepted,
  readOptIn,
  E2EE_PASSPHRASE,
  type OptInStore,
} from '../src/client/e2eeOptIn.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

function fakeStore(initial: string | null = null): OptInStore & { value: string | null } {
  return {
    value: initial,
    read() { return this.value },
    write(v: string) { this.value = v },
    remove() { this.value = null },
  }
}

// A store that throws on everything, which is a real browser: private mode,
// storage disabled, quota exhausted.
const hostileStore: OptInStore = {
  read() { throw new Error('denied') },
  write() { throw new Error('denied') },
  remove() { throw new Error('denied') },
}

console.log('== the passphrase')
check('the exact passphrase is accepted', passphraseAccepted(E2EE_PASSPHRASE))
check('surrounding whitespace is tolerated, because paste adds it',
  passphraseAccepted(`  ${E2EE_PASSPHRASE}\n`))
check('a wrong passphrase is refused', !passphraseAccepted('e2eetest-nope'))
check('the empty string is refused', !passphraseAccepted(''))
check('case matters -- the operator was given an exact string',
  !passphraseAccepted(E2EE_PASSPHRASE.toLowerCase()))

console.log('\n== turning it on')
{
  const s = fakeStore()
  check('a wrong passphrase does not enable it',
    applyOptIn(s, 'wrong', true) === 'bad-passphrase' && readOptIn(s) === false)
  check('the right passphrase enables it',
    applyOptIn(s, E2EE_PASSPHRASE, true) === 'enabled' && readOptIn(s) === true)
}

console.log('\n== turning it off')
{
  const s = fakeStore('1')
  check('off needs NO passphrase -- a switch you cannot undo is a trap',
    applyOptIn(s, '', false) === 'disabled' && readOptIn(s) === false)
}

console.log('\n== failing closed')
check('an unset store reads as off', readOptIn(fakeStore()) === false)
check('a store holding junk reads as off', readOptIn(fakeStore('yes')) === false)
check('a store that THROWS on read reads as off, never on',
  readOptIn(hostileStore) === false)
check('a store that throws on write reports failure rather than a false success',
  applyOptIn(hostileStore, E2EE_PASSPHRASE, true) === 'bad-passphrase')
check('a store that throws on remove still reports disabled',
  applyOptIn(hostileStore, '', false) === 'disabled')

console.log('\n== the reload')
// Crypto is built once with the client, so a change here is inert until the
// page reloads. Claiming otherwise would put encryption UI over a client with
// no crypto object at all.
check('a change requires a reload', needsReload(false, true) && needsReload(true, false))
check('no change requires no reload', !needsReload(false, false) && !needsReload(true, true))

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
