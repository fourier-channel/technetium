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

console.log("\n-- an identity this device cannot use is not a blank slate --")
{
  // Found 2026-09-10 on a real account. claudetwo had a cross-signing identity
  // on the SERVER, no private keys on the device, and no backup. recoveryPlan
  // answered `create-all`, so the panel offered "Set up a recovery key" and
  // pressing it tried to upload a NEW identity over the working one. Only
  // Synapse demanding interactive auth stopped it.
  //
  // The old checks passed throughout, because they exhaustively covered the
  // BACKUP rule and this is the same rule applied to the thing that signs it.
  const every: { i: CryptoIdentityFacts; b: KeyBackupFacts }[] = []
  for (const accountHasIdentity of [false, true])
    for (const privateKeysOnThisDevice of [false, true])
      for (const privateKeysInSecretStorage of [false, true])
        for (const thisDeviceVerified of [false, true])
          for (const backupExists of [false, true])
            for (const backupTrusted of [false, true])
              for (const activeVersion of [null, "1"])
                every.push({
                  i: { accountHasIdentity, privateKeysOnThisDevice, privateKeysInSecretStorage,
                       keyBackupVersion: activeVersion, thisDeviceVerified,
                       otherDeviceCount: 0 } as CryptoIdentityFacts,
                  b: { backupExists, backupTrusted, activeVersion } as KeyBackupFacts,
                })

  const unusable = every.filter(({ i }) =>
    i.accountHasIdentity && !i.privateKeysOnThisDevice && !i.privateKeysInSecretStorage)
  check(`over all ${every.length} states, an unusable identity NEVER authorises creating one`,
    unusable.every(({ i, b }) => !maySetUpNewBackup(recoveryPlan(i, b))),
    unusable.filter(({ i, b }) => maySetUpNewBackup(recoveryPlan(i, b))).slice(0, 3))
  check("with no backup, that state is named rather than lumped into a generic refusal",
    unusable.filter(({ b }) => !b.backupExists)
      .every(({ i, b }) => recoveryPlan(i, b) === "refuse-would-replace-identity"))
  // The fresh-account path must still work, or the fix has broken setup.
  const fresh = every.filter(({ i, b }) => !i.accountHasIdentity && !b.backupExists)
  check("a genuinely fresh account can still create everything",
    fresh.every(({ i, b }) => maySetUpNewBackup(recoveryPlan(i, b))))
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
