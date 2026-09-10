// Whether this device may replace the account's recovery key.
//
// "Generate a new recovery key" is the one secret-storage change that is not
// destructive IF this device can refill the new storage with everything the
// old one held: the three cross-signing private keys and the backup decryption
// key. The SDK copies each of those into the new storage only when it is
// cached on this device. A key it does not have is simply absent from the new
// storage -- and the old storage, with the old key, is gone. That is how a
// "harmless" key rotation orphans an identity, so the decision is made here,
// from observed facts, and the action refuses anything but 'ok'.
//
// Nothing here creates a backup or an identity. A device with no secret
// storage wants the set-up path (recoveryPlan.ts), not this one.

export interface RecoveryKeyChangeFacts {
  // Secret storage exists with a default key: there is something to replace.
  secretStorageReady: boolean
  // All three cross-signing private keys are cached on this device.
  identityKeysLocal: boolean
  // A key backup exists on the server.
  backupExists: boolean
  // The backup decryption key is cached on this device.
  backupKeyLocal: boolean
}

export type RecoveryKeyChangePlan =
  | 'ok'
  // Nothing to rotate; set recovery up instead.
  | 'refuse-no-secret-storage'
  // The new storage would lack the identity keys: no device could ever get
  // them again, and every device would need a reset to verify anything.
  | 'refuse-identity-not-here'
  // A backup exists and its key is not on this device: the new storage would
  // not carry it, and the backup would become unreadable to future devices.
  | 'refuse-backup-key-not-here'

export function recoveryKeyChangePlan(f: RecoveryKeyChangeFacts): RecoveryKeyChangePlan {
  if (!f.secretStorageReady) return 'refuse-no-secret-storage'
  if (!f.identityKeysLocal) return 'refuse-identity-not-here'
  if (f.backupExists && !f.backupKeyLocal) return 'refuse-backup-key-not-here'
  return 'ok'
}

export function mayChangeRecoveryKey(plan: RecoveryKeyChangePlan): boolean {
  return plan === 'ok'
}

// What to tell the user instead. A refusal that does not name the way round
// reads as the app being broken.
export const RECOVERY_KEY_CHANGE_TEXT: Record<Exclude<RecoveryKeyChangePlan, 'ok'>, string> = {
  'refuse-no-secret-storage': 'There is no recovery key to replace yet. Set up recovery first.',
  'refuse-identity-not-here': 'This device does not hold your identity keys, so a new recovery key made here would leave them behind. Enter your current recovery key on this device first, then make a new one.',
  'refuse-backup-key-not-here': 'This device cannot read your key backup, so a new recovery key made here would lock the backup. Enter your current recovery key on this device first, then make a new one.',
}
