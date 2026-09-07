// What a person is told during a device verification, decided from the phase
// alone so it can be swept by a proof.
//
// The rule this exists to hold: a verification that ended without succeeding
// must never read as one that succeeded. Cancelled is the dangerous phase --
// it arrives on a timeout, on the other device saying no, and on a mismatched
// code, and the last of those is a security event rather than a hiccup. None
// of them may be drawn as done.
//
// Phase numbers rather than the SDK enum, so this file stays free of the
// client and testable on its own: 1 Unsent, 2 Requested, 3 Ready, 4 Started,
// 5 Cancelled, 6 Done.
export type VerificationStageName =
  | 'idle' | 'waiting' | 'ready' | 'compare' | 'cancelled' | 'done' | 'unknown'

export interface VerificationStage {
  name: VerificationStageName
  headline: string
  instruction: string
  // May the user say "these match"? Only when there is something to compare.
  canConfirm: boolean
  // May they stop it? Never once it is over.
  canCancel: boolean
  // Nothing further will happen on its own.
  terminal: boolean
  // Did it end in trust? The one field a caller may use to say "verified".
  verified: boolean
}

export function verificationStage(phase: number | null, hasEmoji: boolean): VerificationStage {
  const base = { canConfirm: false, canCancel: true, terminal: false, verified: false }
  switch (phase) {
    case null:
      return { ...base, name: 'idle', canCancel: false,
        headline: 'Not verifying anything right now.',
        instruction: 'Pick a device to verify against.' }
    case 1:
    case 2:
      return { ...base, name: 'waiting',
        headline: 'Waiting for your other device.',
        instruction: 'Accept the request there. This will not continue until you do.' }
    case 3:
      return { ...base, name: 'ready',
        headline: 'Both devices are ready.',
        instruction: 'Starting the comparison.' }
    case 4:
      return hasEmoji
        ? { ...base, name: 'compare', canConfirm: true,
            headline: 'Do both devices show the same picture?',
            instruction: 'Compare them, in the same order. Only say they match if every one does.' }
        : { ...base, name: 'ready',
            headline: 'Comparing.',
            instruction: 'Waiting for the pictures to appear on both devices.' }
    case 5:
      // Cancelled is NOT a soft failure and must not be phrased as one. A
      // mismatch arrives here, and a mismatch means someone may be listening.
      return { ...base, name: 'cancelled', canCancel: false, terminal: true,
        headline: 'Verification stopped, and nothing was verified.',
        instruction: 'If you stopped it because the pictures differed, do not try again on this network -- that mismatch is what an interceptor looks like.' }
    case 6:
      return { ...base, name: 'done', canCancel: false, terminal: true, verified: true,
        headline: 'Verified.',
        instruction: 'Both devices now trust each other, and other people can see it.' }
    default:
      // An unknown phase is not a success. Saying nothing true is better than
      // guessing toward "done".
      return { ...base, name: 'unknown', canCancel: true,
        headline: 'This verification is in a state this app does not recognise.',
        instruction: 'Stopping and starting again is safe; nothing is trusted until it says Verified.' }
  }
}
