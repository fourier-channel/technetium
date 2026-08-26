// ---------------------------------------------------------------------------
// Why an encrypted event is not readable, said in words a person can act on.
//
// The rule this implements is D-tp16 applied to the thing users will actually
// hit: a failed decryption must say WHY. A padlock that never resolves and
// never explains itself is the state that makes people conclude encryption is
// broken, and they are not wrong to -- from where they are sitting, an
// unreadable message and a lost message are the same message.
//
// The distinctions here are not cosmetic. "You need to verify this device" is
// something the user can fix in thirty seconds. "This was sent before you
// signed in and there is no backup" is something they can never fix, and
// telling them to wait for it is a lie. They arrive as the same padlock.
//
// Pure, so the harness can load it (O-tp9). Takes the SDK's failure code as a
// plain string rather than importing the enum, so nothing here needs the
// runtime.
// ---------------------------------------------------------------------------

// What the user should understand, and whether anything they do will help.
export type DecryptionOutlook =
  // It should resolve on its own -- keys are in flight or a backup is being read.
  | 'pending'
  // The user can fix this, and the copy says how.
  | 'actionable'
  // Nothing will fix it. Say so rather than implying patience is a strategy.
  | 'permanent'
  // We do not recognise the reason. Never dressed up as one of the above.
  | 'unknown'
  // There is no decryptor at all -- encryption is not enabled in this build.
  // Distinct from every reason above, which describe a decryptor that TRIED
  // and could not. Collapsing the two would tell a user their message failed
  // when nothing ever attempted it, and would imply a fault where there is
  // only an unshipped feature.
  | 'unavailable'

export interface DecryptionExplanation {
  outlook: DecryptionOutlook
  // One line, shown in place of the message body.
  text: string
}

// Codes as strings; see matrix-js-sdk's DecryptionFailureCode. Kept as literals
// deliberately (O-tp9): importing the enum would pull the SDK runtime into a
// module the check harness must be able to load.
const EXPLANATIONS: Record<string, DecryptionExplanation> = {
  // Keys have not arrived yet. Usually transient; the SDK retries.
  MEGOLM_UNKNOWN_INBOUND_SESSION_ID: {
    outlook: 'pending',
    text: 'Waiting for the key to this message.',
  },
  // The sender chose not to send us the key. Not transient, and not our fault.
  MEGOLM_KEY_WITHHELD: {
    outlook: 'permanent',
    text: 'The sender did not share the key to this message.',
  },
  // The one withholding case the user CAN fix, and the most important string
  // in this file: it is the difference between "encryption is broken" and
  // "press the verify button".
  MEGOLM_KEY_WITHHELD_FOR_UNVERIFIED_DEVICE: {
    outlook: 'actionable',
    text: 'The sender did not share the key because this device is unverified. Verify it to read this message.',
  },
  // The session is known but from a later point in the conversation.
  OLM_UNKNOWN_MESSAGE_INDEX: {
    outlook: 'permanent',
    text: 'This message was sent before this device could read the conversation.',
  },
  // Sent before this device existed, and nothing was ever backed up.
  HISTORICAL_MESSAGE_NO_KEY_BACKUP: {
    outlook: 'permanent',
    text: 'Sent before you signed in on this device, and no key backup exists to restore it from.',
  },
  // Sent before this device existed; a backup exists but is not set up here.
  HISTORICAL_MESSAGE_BACKUP_UNCONFIGURED: {
    outlook: 'actionable',
    text: 'Sent before you signed in on this device. Enter your recovery key to restore it from your backup.',
  },
  // The backup is working and may yet produce this one.
  HISTORICAL_MESSAGE_WORKING_BACKUP: {
    outlook: 'pending',
    text: 'Restoring this message from your key backup.',
  },
  HISTORICAL_MESSAGE_USER_NOT_JOINED: {
    outlook: 'permanent',
    text: 'Sent before you joined this conversation.',
  },
  SENDER_IDENTITY_PREVIOUSLY_VERIFIED: {
    outlook: 'actionable',
    text: "The sender's identity changed since you verified them. Verify them again to read this message.",
  },
  UNSIGNED_SENDER_DEVICE: {
    outlook: 'permanent',
    text: 'Sent from a device the sender has not verified.',
  },
  UNKNOWN_SENDER_DEVICE: {
    outlook: 'permanent',
    text: 'Sent from a device that cannot be identified.',
  },
  UNKNOWN_ERROR: {
    outlook: 'unknown',
    text: 'This message could not be decrypted.',
  },
}

// The explanation for a failure code.
//
// An unrecognised code -- a new one from a future SDK, or a null we did not
// expect -- resolves to 'unknown' with honest copy. It is never mapped onto the
// nearest familiar reason, because guessing here produces a confident sentence
// about someone's private conversation that may be untrue.
export function explainDecryptionFailure(code: string | null | undefined): DecryptionExplanation {
  if (!code) return { outlook: 'unknown', text: 'This message could not be decrypted.' }
  return EXPLANATIONS[code] ?? { outlook: 'unknown', text: 'This message could not be decrypted.' }
}

// The explanation for a row, accounting for whether we can decrypt AT ALL.
//
// Crypto being switched off is not a decryption failure, and must not be
// reported as one. With the engine absent nothing was attempted, so every
// per-code reason below is not merely unknown but inapplicable -- which is why
// this short-circuits before consulting the code at all.
export function explainUnreadable(
  code: string | null | undefined,
  cryptoAvailable: boolean,
): DecryptionExplanation {
  if (!cryptoAvailable) {
    return {
      outlook: 'unavailable',
      text: 'Encrypted. This client cannot read encrypted messages yet.',
    }
  }
  return explainDecryptionFailure(code)
}

// Whether the client should keep hoping. Drives whether the row shows a
// working indicator or settles into a final state -- a spinner that never
// stops is G-tc06's family: something that waits forever on an event that will
// not come.
export function isDecryptionPending(code: string | null | undefined): boolean {
  return explainDecryptionFailure(code).outlook === 'pending'
}

// Every code this module knows, for the check that asserts it covers the SDK.
export function knownFailureCodes(): readonly string[] {
  return Object.keys(EXPLANATIONS)
}
