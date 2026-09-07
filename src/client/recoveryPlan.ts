// What setting up recovery is allowed to DO, decided before anything is called.
//
// This exists because the obvious call is destructive in a way its name hides.
// `bootstrapSecretStorage({ setupNewKeyBackup: true })` resets the key backup
// as a side effect, and G-e1 is emphatic: deleting a backup version DESTROYS
// the keys in it, whatever the docs imply. (The call is deliberately not named
// here -- a check requires that searching for it finds only the module that
// performs it, and a mention in a comment is a false hit.) So "set up recovery" pressed by someone who already
// has a backup is not a setup -- it is a deletion with a friendly label.
//
// The rule this encodes: never reset a backup that exists as a side effect of
// creating one. If a backup is there, the honest answers are to connect to it
// or to restore from it, and replacing it is a separate, explicitly confirmed
// act (E11's territory, not this one's).
import type { CryptoIdentityFacts } from './cryptoIdentity'
import type { KeyBackupFacts } from './keyBackup'

export type RecoveryPlan =
  // Nothing exists yet: create cross-signing, secret storage and a backup, and
  // show the recovery key once.
  | 'create-all'
  // Storage is set up but there is no backup to put keys in.
  | 'create-backup-only'
  // A backup already exists. Creating would reset it, so this refuses and the
  // caller must offer connect or restore instead.
  | 'refuse-would-destroy'
  // There is nothing left to set up.
  | 'already-complete'
  // The facts are unknown. Never guess toward a destructive branch.
  | 'unknown'

export function recoveryPlan(
  identity: CryptoIdentityFacts | null,
  backup: KeyBackupFacts | null,
): RecoveryPlan {
  // Unknown facts must never resolve to an action. A failed observation that
  // reads as "no backup exists" is exactly how a backup gets reset.
  if (!identity || !backup) return 'unknown'

  if (backup.backupExists) {
    // Complete only when the keys are genuinely safe: a backup that exists but
    // is untrusted or unconnected is not protection, and saying "complete"
    // would end the flow with the user no safer than before.
    if (backup.backupTrusted && backup.activeVersion && identity.privateKeysInSecretStorage) {
      return 'already-complete'
    }
    return 'refuse-would-destroy'
  }

  return identity.privateKeysInSecretStorage ? 'create-backup-only' : 'create-all'
}

// Whether this plan may pass `setupNewKeyBackup` to the SDK. The whole point of
// the type above is that this is a single, auditable place.
export function maySetUpNewBackup(plan: RecoveryPlan): boolean {
  return plan === 'create-all' || plan === 'create-backup-only'
}

// A recovery key the user typed. Validated by the SDK's own decoder, passed in
// so this stays pure and testable; a key that does not decode must never reach
// a restore call, because the failure there is opaque and looks like data loss.
export function recoveryKeyIsWellFormed(
  key: string,
  decode: (k: string) => unknown,
): boolean {
  const trimmed = key.trim()
  if (!trimmed) return false
  try {
    return !!decode(trimmed)
  } catch {
    return false
  }
}
