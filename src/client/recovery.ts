// Creating and restoring recovery, with the decision made elsewhere.
//
// Every dangerous choice here is delegated to recoveryPlan.ts, which is pure
// and swept by a proof. This module is only the hands: it refuses to act when
// the plan says so, and it never decides for itself.
import type { MatrixClient } from 'matrix-js-sdk'
import { decodeRecoveryKey } from 'matrix-js-sdk/lib/crypto-api/recovery-key'
import { maySetUpNewBackup, recoveryKeyIsWellFormed, type RecoveryPlan } from './recoveryPlan'

export interface RecoveryCreated {
  // Shown to the user ONCE and never stored by us. If they lose it and lose
  // their devices, the conversations are gone -- so the UI must treat this
  // string as the whole point of the flow rather than a detail of it.
  recoveryKey: string
}

export type RecoveryFailure =
  | 'refused-by-plan'
  | 'no-crypto'
  | 'key-not-generated'
  | 'failed'

// Create cross-signing, secret storage and a key backup, and hand back the
// recovery key exactly once.
//
// The guard is the first line on purpose. `setupNewKeyBackup` resets an
// existing backup, and a reset destroys the keys in it (G-e1) -- so this
// refuses outright unless the plan authorised it, rather than trusting the
// caller to have checked.
export async function createRecovery(
  client: MatrixClient,
  plan: RecoveryPlan,
): Promise<RecoveryCreated | RecoveryFailure> {
  if (!maySetUpNewBackup(plan)) return 'refused-by-plan'
  const crypto = client.getCrypto()
  if (!crypto) return 'no-crypto'

  let generated: string | undefined
  try {
    await crypto.bootstrapCrossSigning({})
    await crypto.bootstrapSecretStorage({
      setupNewKeyBackup: true,
      // NOT setupNewSecretStorage: that is the "reset even if keys already
      // exist" flag, and existing keys are exactly the case the plan refuses.
      createSecretStorageKey: async () => {
        const key = await crypto.createRecoveryKeyFromPassphrase()
        generated = key.encodedPrivateKey
        return key
      },
    })
  } catch (err) {
    console.error('[crypto] recovery setup failed', err)
    return 'failed'
  }

  // A setup that completed without producing a key to show is a silent
  // half-success: the account changed and the user has nothing to write down.
  // Reported as a failure so the UI cannot present it as done.
  return generated ? { recoveryKey: generated } : 'key-not-generated'
}

export type RestoreOutcome =
  | 'restored'
  // The text is not a recovery key at all -- refused before anything is written.
  | 'bad-key'
  // A real key, but not the one this backup was made with.
  | 'wrong-key'
  | 'no-backup'
  | 'no-crypto'
  | 'failed'

// Unlock this device's access to history using a recovery key the user typed.
//
// Non-destructive by construction: it reads the backup and decrypts what is
// already there. The key is checked for shape first, because a decode failure
// deep inside a restore surfaces as an opaque error that reads like data loss.
export async function restoreFromRecoveryKey(
  client: MatrixClient,
  typedKey: string,
): Promise<RestoreOutcome> {
  if (!recoveryKeyIsWellFormed(typedKey, decodeRecoveryKey)) return 'bad-key'
  const crypto = client.getCrypto()
  if (!crypto) return 'no-crypto'
  try {
    const info = await crypto.getKeyBackupInfo()
    if (!info?.version) return 'no-backup'
    // The typed key has to be GIVEN to the SDK, not merely validated: an
    // earlier cut of this function checked the key's shape and then called
    // restore without passing it anywhere, which would have succeeded or
    // failed for reasons having nothing to do with what the user typed.
    await crypto.storeSessionBackupPrivateKey(decodeRecoveryKey(typedKey.trim()), info.version)
    await crypto.restoreKeyBackup()
    return 'restored'
  } catch (err) {
    // A key can be well-formed and still be the wrong key -- that is the
    // common case, someone pasting an old one -- and it must not be reported
    // as a system failure, which would send them looking for a fault that is
    // not there.
    const name = (err as { name?: string } | null)?.name ?? ''
    const text = String((err as { message?: string } | null)?.message ?? '')
    if (/DecryptionKeyDoesNotMatch/i.test(name) || /does not match|MAC|decrypt/i.test(text)) {
      console.warn('[crypto] the recovery key did not match this backup')
      return 'wrong-key'
    }
    console.error('[crypto] restore from recovery key failed', err)
    return 'failed'
  }
}
