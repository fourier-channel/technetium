// Checks for recoveryKeyPlan: when may this device replace the recovery key.
//
// The dangerous direction is permissive. A plan that says 'ok' while a key
// the new storage must carry is not on this device turns a routine rotation
// into an orphaned identity or a locked backup, and nothing tells the user
// until a later device cannot verify. Every refusal is pinned individually,
// and the one 'ok' case requires everything.
import { recoveryKeyChangePlan, mayChangeRecoveryKey, RECOVERY_KEY_CHANGE_TEXT } from '../src/client/recoveryKeyPlan.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const all = { secretStorageReady: true, identityKeysLocal: true, backupExists: true, backupKeyLocal: true }

check('everything here: ok', recoveryKeyChangePlan(all) === 'ok')
check('no backup at all, identity here: ok', recoveryKeyChangePlan({ ...all, backupExists: false, backupKeyLocal: false }) === 'ok')
check('no secret storage: refuse, set up instead', recoveryKeyChangePlan({ ...all, secretStorageReady: false }) === 'refuse-no-secret-storage')
check('identity keys not here: refuse', recoveryKeyChangePlan({ ...all, identityKeysLocal: false }) === 'refuse-identity-not-here')
check('backup exists, its key not here: refuse', recoveryKeyChangePlan({ ...all, backupKeyLocal: false }) === 'refuse-backup-key-not-here')
check('identity missing outranks backup missing (both true -> identity named)',
  recoveryKeyChangePlan({ ...all, identityKeysLocal: false, backupKeyLocal: false }) === 'refuse-identity-not-here')
check('only ok may act', mayChangeRecoveryKey('ok') && !mayChangeRecoveryKey('refuse-identity-not-here')
  && !mayChangeRecoveryKey('refuse-backup-key-not-here') && !mayChangeRecoveryKey('refuse-no-secret-storage'))
for (const k of Object.keys(RECOVERY_KEY_CHANGE_TEXT) as (keyof typeof RECOVERY_KEY_CHANGE_TEXT)[]) {
  check(`refusal text for ${k} names a way round`, /set up|enter your current recovery key/i.test(RECOVERY_KEY_CHANGE_TEXT[k]))
}

// SOURCE GUARD: the rotation must never pass setupNewKeyBackup, which resets
// the backup and destroys the keys in it. Read as text because the option is
// a plain boolean and a type cannot forbid it.
import { readFileSync } from 'node:fs'
const src = readFileSync(new URL('../src/client/recovery.ts', import.meta.url), 'utf8')
const rot = src.slice(src.indexOf('export async function changeRecoveryKey'))
check('changeRecoveryKey never sets setupNewKeyBackup', !/setupNewKeyBackup\s*:\s*true/.test(rot))
check('changeRecoveryKey sets setupNewSecretStorage', /setupNewSecretStorage:\s*true/.test(rot))
check('changeRecoveryKey is guarded by the plan first', /if \(!mayChangeRecoveryKey\(plan\)\) return 'refused-by-plan'/.test(rot))

if (failures > 0) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nall recoveryKeyPlan checks passed')
