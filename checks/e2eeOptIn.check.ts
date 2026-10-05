// Checks for the per-browser encryption switch -- which, since 2026-10-05,
// turns encryption OFF (operator: "E2EE is defaulted to ON and the passphrase
// box in settings allows it to be turned OFF. Change it to 'E2EE' from
// 'E2EETEST'.").
//
// The safety property is the asymmetry, now pointing the other way: every
// path that cannot be proven answers "not opted out", so the worst a broken
// store can do is leave encryption ON. Off -- the direction that costs the
// user something -- is the guarded one; the way back is never guarded.
import { readFileSync } from 'node:fs'
import {
  applyOptOut,
  needsReload,
  passphraseAccepted,
  readOptOut,
  E2EE_PASSPHRASE,
  E2EE_OPT_OUT_KEY,
  LEGACY_E2EE_OPT_IN_KEY,
  type OptInStore,
} from '../src/client/e2eeOptIn.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')

function fakeStore(initial: string | null = null): OptInStore & { value: string | null } {
  return {
    value: initial,
    read() { return this.value },
    write(v: string) { this.value = v },
    remove() { this.value = null },
  }
}
// A store that throws on everything: private mode, storage disabled, quota.
const hostileStore: OptInStore = {
  read() { throw new Error('denied') },
  write() { throw new Error('denied') },
  remove() { throw new Error('denied') },
}

console.log('== the passphrase is "E2EE"')
check('the word is E2EE', E2EE_PASSPHRASE === 'E2EE')
check('it is accepted exactly', passphraseAccepted('E2EE'))
check('the old word is not', !passphraseAccepted('E2EETEST'))
check('surrounding whitespace is tolerated, because paste adds it', passphraseAccepted('  E2EE\n'))
check('case matters -- the operator gave an exact string', !passphraseAccepted('e2ee'))
check('the empty string is refused', !passphraseAccepted(''))

console.log('\n== on by default')
check('an unset store is not opted out', readOptOut(fakeStore()) === false)
check('junk is not an opt-out', readOptOut(fakeStore('yes')) === false)
check('a store that THROWS on read is not an opt-out: encryption stays on', readOptOut(hostileStore) === false)
check('the old opt-IN key means nothing now: its key is not the one read', E2EE_OPT_OUT_KEY !== LEGACY_E2EE_OPT_IN_KEY)

console.log('\n== turning it OFF takes the passphrase')
{
  const s = fakeStore()
  check('a wrong passphrase does not turn it off', applyOptOut(s, 'wrong', true) === 'bad-passphrase' && readOptOut(s) === false)
  check('the old word does not either', applyOptOut(s, 'E2EETEST', true) === 'bad-passphrase' && readOptOut(s) === false)
  check('E2EE turns it off', applyOptOut(s, 'E2EE', true) === 'turned-off' && readOptOut(s) === true)
  check('a store that refuses the write reports failure, not a false off', applyOptOut(hostileStore, 'E2EE', true) === 'bad-passphrase')
}

console.log('\n== turning it back ON does not')
{
  const s = fakeStore('1')
  check('no passphrase needed for the way back', applyOptOut(s, '', false) === 'turned-on' && readOptOut(s) === false)
  check('a store that throws on remove still reports on', applyOptOut(hostileStore, '', false) === 'turned-on')
}

console.log('\n== the reload')
check('a change requires a reload', needsReload(false, true) && needsReload(true, false))
check('no change requires no reload', !needsReload(false, false) && !needsReload(true, true))

console.log('\n== every build, no flag')
{
  const crypto = read('src/client/crypto.ts')
  check('encryption at startup is exactly "not opted out"', /const E2EE_AT_STARTUP = !readOptOut\(browserOptOutStore\)/.test(crypto))
  check('no build flag reads any more', !/import\.meta\.env\.VITE_E2EE/.test(crypto) && !/e2eeFromBuild/.test(crypto))
  const env = read('.env.production')
  check('.env.production no longer pins it off', !/^VITE_E2EE=/m.test(env))
  const ui = read('src/ui/EncryptionOptions.tsx')
  check('the switch: off behind the passphrase, back on without it',
    /onClick=\{\(\) => flipOptOut\(true\)\}/.test(ui) && /disabled=\{!passphrase\.trim\(\)\} onClick=\{\(\) => flipOptOut\(true\)\}/.test(ui) &&
    /onClick=\{\(\) => flipOptOut\(false\)\}>Turn encryption back on/.test(ui))
  check('and no "in this build" copy anywhere', ![
    'src/ui/EncryptionOptions.tsx', 'src/ui/encryptionSummary.ts', 'src/client/decryptionState.ts',
  ].some((f) => /in this build/.test(read(f))))
}

console.log('\n== the hazards stay')
{
  const ss = read('src/client/slidingSync.ts')
  check('m.room.encryption is still in sliding sync\'s required state', /m\.room\.encryption|EventType\.RoomEncryption/.test(ss))
  check('the one-tab lock is taken before any client is built', (() => {
    const ctx = read('src/client/ClientContext.tsx')
    const start = ctx.slice(ctx.indexOf('const startSyncedClient = async'))
    return start.indexOf('acquireDeviceLock(') > 0 && start.indexOf('acquireDeviceLock(') < start.indexOf('await buildClient(')
  })())
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\ne2ee opt-out: all ok')
