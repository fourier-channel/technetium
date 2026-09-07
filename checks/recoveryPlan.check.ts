// Setting up recovery must never destroy a backup that already exists.
// G-e1: deleting a key backup version DESTROYS the keys in it, and the SDK's
// bootstrap call resets the backup as a side effect of "setting up".
import { recoveryPlan, maySetUpNewBackup, recoveryKeyIsWellFormed } from '../src/client/recoveryPlan'
import type { CryptoIdentityFacts } from '../src/client/cryptoIdentity'
import type { KeyBackupFacts } from '../src/client/keyBackup'

let failures = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name + (extra === undefined ? '' : ' -- ' + JSON.stringify(extra))) }
}
const ident = (o: Partial<CryptoIdentityFacts> = {}): CryptoIdentityFacts => ({
  accountHasIdentity: true, privateKeysOnThisDevice: true, privateKeysInSecretStorage: true,
  keyBackupVersion: '1', thisDeviceVerified: true, otherDeviceCount: 1, ...o,
})
const backup = (o: Partial<KeyBackupFacts> = {}): KeyBackupFacts => ({
  backupExists: true, backupTrusted: true, activeVersion: '1', ...o,
})

{
  check('a fresh account creates everything',
    recoveryPlan(ident({ privateKeysInSecretStorage: false }), backup({ backupExists: false, activeVersion: null })) === 'create-all')
  check('storage without a backup creates only the backup',
    recoveryPlan(ident(), backup({ backupExists: false, activeVersion: null })) === 'create-backup-only')
  check('a healthy account has nothing to do', recoveryPlan(ident(), backup()) === 'already-complete')
}

// --- the whole point ---------------------------------------------------------
{
  check('an existing backup is never reset by a setup',
    recoveryPlan(ident(), backup({ activeVersion: null })) === 'refuse-would-destroy')
  check('nor an untrusted one, which is still someone keys',
    recoveryPlan(ident(), backup({ backupTrusted: false })) === 'refuse-would-destroy')
  check('nor when the private keys are not in storage',
    recoveryPlan(ident({ privateKeysInSecretStorage: false }), backup()) === 'refuse-would-destroy')
  for (const plan of ['refuse-would-destroy', 'already-complete', 'unknown'] as const) {
    check(`'${plan}' may not pass setupNewKeyBackup`, maySetUpNewBackup(plan) === false)
  }
  check("'create-all' may", maySetUpNewBackup('create-all'))
  check("'create-backup-only' may", maySetUpNewBackup('create-backup-only'))
}

// --- unknown facts never walk toward destruction ----------------------------
{
  check('no identity is unknown, not create', recoveryPlan(null, backup({ backupExists: false })) === 'unknown')
  check('no backup facts is unknown, not "there is no backup"', recoveryPlan(ident(), null) === 'unknown')
  check('and unknown may not set up a backup', maySetUpNewBackup(recoveryPlan(null, null)) === false)
}

// --- over the whole space: destruction is impossible from this function -----
{
  let unsafe = 0
  for (const inStorage of [true, false]) for (const exists of [true, false]) for (const trusted of [true, false]) for (const active of ['1', null]) {
    const plan = recoveryPlan(ident({ privateKeysInSecretStorage: inStorage }), backup({ backupExists: exists, backupTrusted: trusted, activeVersion: active as string | null }))
    // The invariant: if a backup exists, nothing may be authorised to reset it.
    if (exists && maySetUpNewBackup(plan)) unsafe++
  }
  check('no combination authorises resetting an existing backup', unsafe === 0, unsafe)
}

// --- the typed key ----------------------------------------------------------
{
  const good = (k: string) => (k === 'GOOD KEY' ? { ok: true } : (() => { throw new Error('bad') })())
  check('a well-formed key passes', recoveryKeyIsWellFormed('GOOD KEY', good))
  check('surrounding whitespace is not the user being wrong', recoveryKeyIsWellFormed('  GOOD KEY  ', good))
  check('a key that does not decode is refused before it reaches a restore', !recoveryKeyIsWellFormed('nonsense', good))
  check('an empty box is refused without calling the decoder', !recoveryKeyIsWellFormed('   ', () => { throw new Error('should not be called') }))
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
