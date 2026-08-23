// ---------------------------------------------------------------------------
// What to do about this account's cross-signing identity -- decided here, as a
// pure function, because the wrong answer is unrecoverable.
//
// Technetium is the LAST client on this network to adopt E2EE, not the first.
// Almost everyone arriving already holds a cross-signing identity and a live
// key backup made elsewhere. So the dangerous call is the one that looks like
// ordinary setup: bootstrapping cross-signing with the SDK's reset option set
// against an account that already has an identity replaces working credentials
// and orphans every key in the user's backup (D-e1), and deleting a backup
// version really does destroy the keys in it, whatever Synapse's docstring
// claims (G-e1). That option's name is asserted absent from every module but
// the gated reset -- see checks/cryptoIdentity.check.ts.
//
// The safety property this module exists to guarantee, and which the checks
// assert over the ENTIRE input space rather than over examples:
//
//     a reset is permitted for exactly one decision, and that decision is
//     never reached while any non-destructive route remains.
//
// Pure, so the harness can load it (O-tp9). No React, no matrix-js-sdk.
// ---------------------------------------------------------------------------

// What we observed about the account. Gathered impurely by
// `observeCryptoIdentity` in ./crypto; every field is a question the SDK can
// answer directly, so nothing here is inferred twice.
export interface CryptoIdentityFacts {
  // Does the SERVER hold published cross-signing keys for this account? This
  // is the field that decides whether there is anything to destroy.
  accountHasIdentity: boolean
  // Are the private cross-signing keys cached on THIS device already?
  privateKeysOnThisDevice: boolean
  // Are the private keys retrievable from secret storage, given the recovery key?
  privateKeysInSecretStorage: boolean
  // Is there a live server-side key backup version?
  keyBackupVersion: string | null
  // Is THIS device signed by the account's identity?
  thisDeviceVerified: boolean
  // How many OTHER devices the account has. A device we could verify against
  // is a non-destructive route, so this is the last thing standing between a
  // user and the reset flow.
  otherDeviceCount: number
}

export type IdentityAction =
  // Nothing to do.
  | 'ready'
  // No identity exists anywhere. Creating one destroys nothing, and on this
  // server it needs no interactive auth.
  | 'bootstrap-new'
  // An identity exists and its private keys are already on this device; publish
  // and sign this device. Non-destructive.
  | 'adopt-existing'
  // An identity exists and its keys are in secret storage. Ask for the recovery
  // key. Non-destructive.
  | 'recover-from-secret-storage'
  // An identity exists, its keys are not reachable here, but another device
  // holds them and can verify us. Non-destructive.
  | 'verify-with-other-device'
  // An identity exists and NO non-destructive route remains. The only way
  // forward destroys it. Offered, never taken automatically, and only behind
  // the confirmation gate (D-e1) with a key export first (D-e2).
  | 'reset-required'

// The decision.
//
// Ordering is the whole algorithm: every non-destructive route is exhausted
// before 'reset-required' can be returned, and the "nothing exists yet" case is
// tested FIRST so that a fresh account can never fall through into a branch
// that reasons about destroying something.
export function decideIdentityAction(f: CryptoIdentityFacts): IdentityAction {
  // Nothing on the server means nothing to lose. This is the only branch that
  // may create an identity from scratch.
  if (!f.accountHasIdentity) return 'bootstrap-new'

  // From here down, an identity EXISTS. Every branch must preserve it.
  if (f.privateKeysOnThisDevice) {
    return f.thisDeviceVerified ? 'ready' : 'adopt-existing'
  }
  if (f.privateKeysInSecretStorage) return 'recover-from-secret-storage'
  if (f.otherDeviceCount > 0) return 'verify-with-other-device'
  return 'reset-required'
}

// Whether a destructive reset may be performed at all.
//
// The ONLY caller-visible permission to perform a destructive reset.
// Everything else in the client asks this function rather than reasoning about
// the decision itself, so there is one place to audit and one place to break.
export function resetPermitted(action: IdentityAction): boolean {
  return action === 'reset-required'
}

// Whether this action can proceed without asking the user for anything.
//
// Both silent actions make the SAME non-destructive SDK call. That is
// deliberate: if creating and adopting were different calls, the difference
// would eventually be got wrong.
export function isSilentAction(action: IdentityAction): boolean {
  return action === 'bootstrap-new' || action === 'adopt-existing' || action === 'ready'
}

// What the user is told, and what they are asked to do about it. Written as
// consequences, because "cross-signing is not ready" tells a person nothing.
export function identityActionCopy(action: IdentityAction): { title: string; detail: string } {
  switch (action) {
    case 'ready':
      return {
        title: 'Encryption is set up',
        detail: 'This device can read your encrypted conversations.',
      }
    case 'bootstrap-new':
      return {
        title: 'Setting up encryption',
        detail: 'Creating the keys this account will use for private chats.',
      }
    case 'adopt-existing':
      return {
        title: 'Setting up this device',
        detail: 'Using the encryption keys this account already has.',
      }
    case 'recover-from-secret-storage':
      return {
        title: 'Enter your recovery key',
        detail:
          'This account already has encryption set up. Your recovery key unlocks your existing messages on this device.',
      }
    case 'verify-with-other-device':
      return {
        title: 'Verify this device',
        detail:
          'Confirm from a device you are already signed in on. Until you do, this device cannot read your existing encrypted messages.',
      }
    case 'reset-required':
      return {
        title: 'Your encryption keys are not reachable',
        detail:
          'This account has encryption set up, but this device cannot reach the keys and no other device is available to unlock them. Resetting will let you send new encrypted messages, but existing ones will stay unreadable.',
      }
  }
}

// Whether this device can currently READ existing encrypted history.
//
// Deliberately not the same question as "is encryption working". A device can
// send perfectly well while being unable to read a word of the past, and
// telling a user "encryption is on" in that state is the exact false
// reassurance E10 forbids.
export function canReadExistingHistory(f: CryptoIdentityFacts): boolean {
  if (!f.accountHasIdentity) return true // nothing encrypted to read yet
  return f.privateKeysOnThisDevice && f.thisDeviceVerified
}

// Whether losing this device would lose conversations.
//
// True when encryption is in use and no server-side backup exists to restore
// from. This is the state E8 exists to prevent, and the user should be told
// about it while they still have the device.
export function atRiskOfKeyLoss(f: CryptoIdentityFacts): boolean {
  return f.accountHasIdentity && f.keyBackupVersion === null
}
