// What the settings panel says about encryption, decided here rather than in
// the component, so it can be proved over the whole input space.
//
// The facts come from cores that already exist: CryptoIdentityFacts
// (cryptoIdentity.ts) and KeyBackupFacts (keyBackup.ts). This adds no new
// knowledge about crypto -- it only decides what a person is TOLD and what
// they are offered.
//
// Two rules it must not break, both already ruled on:
//   - An unverified device may still SEND (O-e5). Nothing here may imply that
//     the user is locked out; the warning is about what others see and about
//     history, not about permission.
//   - Never promise safety that does not exist. "Backup absent" means losing
//     this device loses the conversations, and it says so.
import type { CryptoIdentityFacts } from '../client/cryptoIdentity'
import { maySetUpNewBackup, recoveryPlan } from '../client/recoveryPlan'
import { keyBackupState, type KeyBackupFacts } from '../client/keyBackup'

export type EncryptionTone = 'off' | 'ok' | 'warn' | 'bad'

export type EncryptionAction =
  // Verify this device against one you already trust. The non-destructive
  // route, and the one to offer first whenever it is available.
  | 'verify-this-device'
  // Create secret storage and a recovery key. The thing that makes the keys
  // survive losing every device.
  | 'set-up-recovery'
  // A recovery key exists; use it to unlock this device's access to history.
  | 'restore-from-key'
  // A trustworthy backup exists but this session is not uploading to it.
  | 'connect-backup'
  // Recovery storage is already set up; what is missing is the backup itself.
  // Named separately from 'set-up-recovery' because telling someone to "set up
  // recovery" when they already have is how a panel loses their trust.
  | 'create-backup'
  // The last resort, offered ONLY when it is genuinely the only route left. It
  // is not a normal action and stays gated in its own section; naming it here
  // is what stops the panel telling someone their keys are at risk and then
  // giving them nothing to press.
  | 'reset-encryption'

export interface EncryptionSummary {
  tone: EncryptionTone
  headline: string
  detail: string[]
  actions: EncryptionAction[]
}

export function encryptionSummary(
  enabled: boolean,
  identity: CryptoIdentityFacts | null,
  backup: KeyBackupFacts | null,
): EncryptionSummary {
  if (!enabled) {
    return {
      tone: 'off',
      headline: 'Encryption is off in this build.',
      detail: ['Messages are stored on the server in a form it can read.'],
      actions: [],
    }
  }
  if (!identity) {
    return {
      tone: 'warn',
      headline: 'Encryption is starting up.',
      detail: ['Nothing is known about this device yet. This usually settles within a few seconds.'],
      actions: [],
    }
  }

  const detail: string[] = []
  const actions: EncryptionAction[] = []
  const backupState = backup ? keyBackupState(backup) : 'absent'

  // Verification first: it is the non-destructive route and it is what other
  // people see when they look at you.
  if (identity.thisDeviceVerified) {
    detail.push('This device is verified.')
  } else if (identity.otherDeviceCount > 0) {
    detail.push('This device is not verified yet. You can still read and send; other people see it as unverified.')
    actions.push('verify-this-device')
  } else {
    detail.push('This device is not verified, and it is your only one.')
  }

  // Then history: can this device read what came before it?
  if (!identity.privateKeysOnThisDevice && identity.privateKeysInSecretStorage) {
    detail.push('Older messages are locked until you enter your recovery key on this device.')
    actions.push('restore-from-key')
  }

  // Then survival: what happens if this device is lost.
  if (backupState === 'active') {
    detail.push('Your keys are backed up, so losing this device does not lose your conversations.')
  } else if (backupState === 'present-disconnected') {
    detail.push('A backup exists but this session is not adding to it, so anything new is not covered.')
    actions.push('connect-backup')
  } else if (backupState === 'present-untrusted') {
    detail.push('A backup exists but cannot be verified as yours, so it is not being used.')
    // DELIBERATELY NO ACTION. This offered 'set-up-recovery', and recoveryPlan
    // REFUSES that while a backup exists -- creating one would reset the
    // existing version and destroy the keys inside it (G-e1). So the panel
    // offered a button that refused when pressed, which the comment further
    // down calls worse than an honest list. Seen on the operator's own account
    // 2026-09-10, with 37 keys in the backup it would have been offering to
    // replace.
    //
    // The honest routes are named instead: verifying against another device
    // (already offered above when there is one), or the reset.
    detail.push(identity.otherDeviceCount > 0
      ? 'Verify this device against one of your others to unlock it -- that is the route that loses nothing.'
      : 'With no other device and no usable recovery key, the reset at the bottom of this panel is the only way forward.')
  } else {
    detail.push('There is no key backup. If you lose this device, those conversations are gone.')
    // Offer only what the PLAN will actually perform.
    //
    // Derived from the same function that executes it, rather than kept in
    // step by hand -- keeping two lists in agreement by hand is exactly what
    // produced a "Set up recovery" button that refuses when pressed, twice: on
    // an untrusted existing backup (above), and here, on an account whose
    // identity this device cannot use.
    const plan = backup ? recoveryPlan(identity, backup) : 'unknown'
    if (maySetUpNewBackup(plan)) {
      // Whichever half is missing is the one offered. Absent backup ALWAYS
      // offers something: the proof found that a person with recovery already
      // set up was told their conversations could be lost and given nothing to
      // press about it.
      actions.push(identity.privateKeysInSecretStorage ? 'create-backup' : 'set-up-recovery')
    } else if (plan === 'refuse-would-replace-identity') {
      detail.push('This account already has an encryption identity that this device cannot use.')
      if (identity.otherDeviceCount > 0) {
        detail.push('Verify against one of your other devices -- that route loses nothing.')
      }
      // The reset is offered whenever nothing else is pressable. Verifying is
      // already offered above for an UNVERIFIED device with somewhere to verify
      // against; a device that is verified and still cannot use the identity
      // has no such route, and telling it "your keys are at risk" with no
      // button is the silence this panel is not allowed to produce.
      if (!actions.includes('verify-this-device')) actions.push('reset-encryption')
    }
  }

  // The tone is the WORST true thing, not an average: a panel that says "ok"
  // while the keys are unbacked has told a comfortable lie.
  const tone: EncryptionTone =
    backupState === 'absent' ? 'bad'
      : !identity.thisDeviceVerified || backupState !== 'active' ? 'warn'
        : 'ok'

  const headline =
    tone === 'ok' ? 'Encryption is on and your keys are safe.'
      : tone === 'bad' ? 'Encryption is on, but your keys are not backed up.'
        : 'Encryption is on, with something left to finish.'

  return { tone, headline, detail, actions: [...new Set(actions)] }
}
