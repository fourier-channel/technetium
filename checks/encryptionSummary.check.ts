// What the settings panel tells a person about encryption. Proved over the
// input space rather than spot-checked, because every one of these states is
// one a real account passes through and the wrong words in any of them are a
// promise of safety that does not exist.
import { encryptionSummary, type EncryptionAction } from '../src/ui/encryptionSummary'
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
const has = (a: EncryptionAction[], x: EncryptionAction) => a.includes(x)

// --- the flag ---------------------------------------------------------------
{
  const s = encryptionSummary(false, ident(), backup())
  check('with encryption off it says so plainly', s.tone === 'off' && /off in this build/i.test(s.headline))
  check('and offers nothing to press', s.actions.length === 0)
  check('and does not imply messages are private', s.detail.join(' ').includes('server'))
}

// --- the good state ---------------------------------------------------------
{
  const s = encryptionSummary(true, ident(), backup())
  check('everything in order reads as ok', s.tone === 'ok', s)
  check('with nothing left to press', s.actions.length === 0, s.actions)
}

// --- the state that must never read as fine ---------------------------------
{
  const s = encryptionSummary(true, ident(), backup({ backupExists: false, activeVersion: null }))
  check('no backup is the WORST tone, not an average', s.tone === 'bad', s)
  check('and it says the conversations would be gone', /gone/i.test(s.detail.join(' ')), s.detail)
  // Recovery storage already exists in this fixture, so the missing half is
  // the backup itself -- and saying "set up recovery" to someone who has would
  // be the panel getting their own account wrong.
  check('and offers to create the backup', has(s.actions, 'create-backup'), s.actions)
  const fresh = encryptionSummary(true, ident({ privateKeysInSecretStorage: false }), backup({ backupExists: false, activeVersion: null }))
  check('with no recovery either, it offers to set that up instead', has(fresh.actions, 'set-up-recovery') && !has(fresh.actions, 'create-backup'), fresh.actions)
}

// --- unverified device: warn, never imply a lockout (O-e5) ------------------
{
  const s = encryptionSummary(true, ident({ thisDeviceVerified: false }), backup())
  check('an unverified device is a warning, not a failure', s.tone === 'warn', s)
  check('it offers verification against another device', has(s.actions, 'verify-this-device'), s.actions)
  check('and says plainly that sending still works', /still read and send/i.test(s.detail.join(' ')), s.detail)
  const alone = encryptionSummary(true, ident({ thisDeviceVerified: false, otherDeviceCount: 0 }), backup())
  check('with no other device it does not offer an impossible verification', !has(alone.actions, 'verify-this-device'), alone.actions)
}

// --- locked history ---------------------------------------------------------
{
  const s = encryptionSummary(true, ident({ privateKeysOnThisDevice: false, privateKeysInSecretStorage: true }), backup())
  check('keys in storage but not here offers the recovery key', has(s.actions, 'restore-from-key'), s.actions)
  check('and explains what is locked', /older messages/i.test(s.detail.join(' ')), s.detail)
}

// --- a backup nobody is using ----------------------------------------------
{
  const s = encryptionSummary(true, ident(), backup({ activeVersion: null }))
  check('a disconnected backup offers to connect', has(s.actions, 'connect-backup'), s.actions)
  check('and does not claim the keys are safe', !/are safe/i.test(s.headline), s.headline)
  const untrusted = encryptionSummary(true, ident(), backup({ backupTrusted: false }))
  check('an untrusted backup is not treated as protection', !/are safe/i.test(untrusted.headline), untrusted.headline)
}

// --- still starting up ------------------------------------------------------
{
  const s = encryptionSummary(true, null, null)
  check('before the facts arrive it says so rather than guessing', s.tone === 'warn' && /starting up/i.test(s.headline))
  check('and offers nothing yet', s.actions.length === 0)
}

// --- over the whole space ---------------------------------------------------
{
  let bad = 0, dupes = 0, silent = 0
  for (const verified of [true, false]) for (const onDevice of [true, false]) for (const inStorage of [true, false]) {
    for (const others of [0, 2]) for (const exists of [true, false]) for (const trusted of [true, false]) for (const active of ['1', null]) {
      const s = encryptionSummary(true, ident({ thisDeviceVerified: verified, privateKeysOnThisDevice: onDevice, privateKeysInSecretStorage: inStorage, otherDeviceCount: others }), backup({ backupExists: exists, backupTrusted: trusted, activeVersion: active as string | null }))
      if (s.detail.length === 0) silent++
      if (new Set(s.actions).size !== s.actions.length) dupes++
      // The one thing that must never happen: "safe" while there is no backup.
      if (!exists && /safe/i.test(s.headline)) bad++
      // Absent backup must always leave the person something to do about it.
      if (!exists && s.actions.length === 0) silent++
    }
  }
  check('no combination ever calls unbacked keys safe', bad === 0, bad)
  check('no combination offers the same action twice', dupes === 0, dupes)
  check('no combination leaves the panel with nothing to say', silent === 0, silent)
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
