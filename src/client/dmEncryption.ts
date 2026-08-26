// ---------------------------------------------------------------------------
// Whether a new DM is created encrypted -- decided here, as a pure function.
//
// The rule (D-e4): never encrypt a room the other party cannot read.
//
// Stated as a CAPABILITY CHECK, deliberately, and not as a list of bot
// accounts to skip. The accounts this protects today are the bridge bots that
// onboard people and handle posting, but a hardcoded list is the part that
// goes stale -- a new integration, a renamed bot, a second homeserver, and the
// list is quietly wrong in the direction that breaks conversations. "Has this
// party ever published a device key" is a question with a real answer, and it
// stays correct without maintenance.
//
// The failure this prevents is total and silent: encrypting a room with a
// participant who has no crypto produces a conversation where one side sends
// into the void and the other receives nothing it can read, with no error on
// either end.
//
// Pure, so the harness can load it (O-tp9).
// ---------------------------------------------------------------------------

export interface DmEncryptionFacts {
  // Is our own crypto engine up and usable? False when the flag is off, when
  // the wasm failed to load, or when the crypto store could not open.
  cryptoAvailable: boolean
  // How many devices the other party has published keys for. Zero means they
  // cannot receive an encrypted message at all -- not "probably not", cannot.
  recipientDeviceCount: number
  // Whether we could actually ASK. A failed lookup is not a zero.
  recipientDevicesKnown: boolean
}

export type DmEncryptionDecision =
  // Create the room encrypted.
  | 'encrypt'
  // Our crypto is not available. Their capability is irrelevant.
  | 'plaintext-no-crypto'
  // They cannot receive encrypted messages.
  | 'plaintext-recipient-cannot'
  // We could not find out, and we do not guess in either direction.
  | 'plaintext-unknown-recipient'

export function decideDmEncryption(f: DmEncryptionFacts): DmEncryptionDecision {
  if (!f.cryptoAvailable) return 'plaintext-no-crypto'
  // An unknown answer is NOT a zero and NOT a yes. Encrypting on a failed
  // lookup risks a conversation nobody can read; treating unknown as "they
  // have no keys" would silently downgrade a real user's DM to plaintext and
  // call it a capability decision. So it gets its own outcome, and its own
  // sentence to the user.
  if (!f.recipientDevicesKnown) return 'plaintext-unknown-recipient'
  if (f.recipientDeviceCount <= 0) return 'plaintext-recipient-cannot'
  return 'encrypt'
}

export function willEncrypt(d: DmEncryptionDecision): boolean {
  return d === 'encrypt'
}

// What the user is told at the top of the new conversation.
//
// Every outcome says something. A DM that is quietly not encrypted, in a
// client that advertises encrypted DMs, is the precise failure E10 exists to
// forbid -- the user believes they have a guarantee they do not have.
export function dmEncryptionNotice(d: DmEncryptionDecision): string {
  switch (d) {
    case 'encrypt':
      return 'Messages here are end-to-end encrypted. Only you and the person you are talking to can read them.'
    case 'plaintext-no-crypto':
      return 'This conversation is NOT encrypted: encryption could not be set up on this device.'
    case 'plaintext-recipient-cannot':
      return 'This conversation is NOT encrypted, because the other party cannot receive encrypted messages. Automated accounts, including the ones that handle posting, do not support encryption.'
    case 'plaintext-unknown-recipient':
      return 'This conversation is NOT encrypted: it was not possible to confirm whether the other party can receive encrypted messages.'
  }
}

// Media disclosure for an encrypted DM (D-e3), stated as ruled.
//
// Separate from the notice above because it answers a different question. The
// notice says who can read the conversation; this says where the pictures go,
// and a user reasoning about one is not automatically reasoning about the other.
export const ENCRYPTED_DM_MEDIA_NOTICE =
  'All media posted in encrypted DMs stays here. Nothing is tagged and nothing is posted to chanbooru.'
