// ---------------------------------------------------------------------------
// Whether this account's conversations would survive losing this device.
//
// Without a key backup, one cleared browser is one unreadable conversation,
// permanently -- and users clear browsers. That is E8's whole reason to exist,
// and it is worth stating plainly because the failure is invisible right up
// until it is total: everything works perfectly until the day the device is
// gone, and then nothing does.
//
// The rule enforced here is narrower than it looks. Only ONE state means the
// keys are actually safe -- the backup exists, is trusted, AND this session is
// connected to it. "A backup exists" is not the same claim, and a client that
// treats it as one tells the user they are protected while their newest keys
// are going nowhere.
//
// Nothing in this module can create or replace a backup. Replacing one DELETES
// the keys in the old version (G-e1), so that lives with the gated reset.
//
// Pure, so the harness can load it (O-tp9).
// ---------------------------------------------------------------------------

export interface KeyBackupFacts {
  // Does the server hold a backup version at all?
  backupExists: boolean
  // Is that backup signed by something we trust? An untrusted backup may have
  // been created by someone who is not the user.
  backupTrusted: boolean
  // Is THIS session actually uploading keys to it? A backup nobody is
  // connected to protects only what was already in it.
  activeVersion: string | null
}

export type KeyBackupState =
  // The keys are safe. The only state that means that.
  | 'active'
  // A backup exists and is trustworthy, but this session is not using it.
  | 'present-disconnected'
  // A backup exists but we cannot vouch for it.
  | 'present-untrusted'
  // No backup. Losing this device loses the conversations.
  | 'absent'

export function keyBackupState(f: KeyBackupFacts): KeyBackupState {
  if (!f.backupExists) return 'absent'
  // Trust is checked BEFORE connection. A backup we cannot vouch for should
  // not be described as merely "not connected yet", which sounds like a thing
  // to fix by pressing a button.
  if (!f.backupTrusted) return 'present-untrusted'
  if (!f.activeVersion) return 'present-disconnected'
  return 'active'
}

// The single predicate every surface asks. One place to audit.
export function keysAreProtected(s: KeyBackupState): boolean {
  return s === 'active'
}

// Whether the user should be prompted about this now.
//
// 'active' needs nothing. Everything else is worth raising, but only 'absent'
// is urgent -- the others have a backup sitting there, and the loss window is
// bounded by what has not been uploaded.
export function keyBackupNeedsAttention(s: KeyBackupState): boolean {
  return s !== 'active'
}

export function keyBackupCopy(s: KeyBackupState): { label: string; detail: string } {
  switch (s) {
    case 'active':
      return {
        label: 'Backed up',
        detail:
          'Your message keys are backed up. If you lose this device you can restore your conversations with your recovery key.',
      }
    case 'present-disconnected':
      return {
        label: 'Backup not connected',
        detail:
          'A key backup exists for this account, but this device is not using it. New messages are NOT being backed up. Enter your recovery key to connect.',
      }
    case 'present-untrusted':
      return {
        label: 'Backup not verified',
        detail:
          'A key backup exists but this device cannot verify it was created by you. Do not rely on it until it is verified.',
      }
    case 'absent':
      return {
        label: 'No backup',
        detail:
          'Your message keys exist only on this device. If you lose it, or clear this browser, your encrypted conversations become permanently unreadable.',
      }
  }
}
