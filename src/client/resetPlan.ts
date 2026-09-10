// ---------------------------------------------------------------------------
// E11 -- what a destructive reset actually costs, decided as a pure function.
//
// This module exists because of G-e2: three things are routinely conflated as
// "your encryption identity", they fail differently, and only some of them are
// destructive. A dialog that gets this wrong in the REASSURING direction makes
// someone throw away history they could have kept; wrong in the frightening
// direction and they stay locked out rather than press a safe button.
//
//   the cross-signing identity  -- who vouches for your devices.
//                                  Replacing it costs TRUST, not messages:
//                                  everyone has to re-verify you.
//   the key backup              -- the server's copy of your message keys.
//                                  Destroying it is FOREVER (G-e1: Synapse's
//                                  delete_e2e_room_keys_version docstring says
//                                  it "doesn't delete their actual key data",
//                                  and the docstring is wrong -- every deleted
//                                  version on the deployed server holds zero
//                                  keys).
//   this device's own keys      -- what this browser can already read.
//                                  A reset does not touch them, which is why
//                                  the export in D-e2 is worth taking.
//
// So the sentence a user needs is not "you will lose your messages". It is
// "you keep what this device already has, and lose whatever existed only in the
// backup" -- and that is a different sentence depending on the facts.
//
// Pure, so every branch is checked over the whole input space (O-tp9). The
// module that actually destroys anything is cryptoReset.ts, which is the ONE
// file the source guard in cryptoIdentity.check.ts permits to name an SDK call
// that can destroy a key.
// ---------------------------------------------------------------------------

import type { CryptoIdentityFacts } from './cryptoIdentity'

export interface ResetPlan {
  // Is there anything to reset? An account with no identity has nothing to
  // destroy, and offering a destructive action there is a trap with no upside.
  meaningful: boolean
  // A server-side backup exists and this reset will replace it, destroying the
  // keys in the old version (G-e1).
  destroysKeyBackup: boolean
  // Messages whose keys live ONLY in that backup become unreadable forever.
  losesBackedUpHistory: boolean
  // Messages this device can already read stay readable: a reset does not clear
  // the local megolm store. This is the half people do not expect.
  keepsLocalHistory: boolean
  // Everyone who verified you must do it again, and you must re-verify your
  // own other devices.
  costsDeviceTrust: boolean
  // Is an export worth taking? Only if this device actually holds keys.
  exportWorthTaking: boolean
}

export function resetPlan(f: CryptoIdentityFacts): ResetPlan {
  const meaningful = f.accountHasIdentity
  const hasBackup = f.keyBackupVersion !== null
  return {
    meaningful,
    destroysKeyBackup: meaningful && hasBackup,
    losesBackedUpHistory: meaningful && hasBackup,
    // The local store survives a reset whatever else happens. Stated as its own
    // field rather than inferred, because it is the reassurance that stops a
    // panicking user from also wiping their browser.
    keepsLocalHistory: meaningful,
    costsDeviceTrust: meaningful,
    // An export contains what THIS DEVICE holds. A device that never had the
    // private keys and was never verified is unlikely to hold much, but "unlikely
    // to hold much" is not "nothing" -- so this is true whenever crypto is
    // running at all, and the copy says what the file will and will not contain.
    exportWorthTaking: meaningful,
  }
}

// The two lists the dialog shows. Kept here rather than in the component so the
// wording is checked, and so a future edit cannot quietly move an item from one
// column to the other.
export function resetCopy(plan: ResetPlan): { willLose: string[]; willKeep: string[] } {
  const willLose: string[] = []
  const willKeep: string[] = []
  if (!plan.meaningful) return { willLose, willKeep }
  if (plan.costsDeviceTrust) {
    willLose.push('Your encryption identity. Everyone who verified you will see you as unverified until they verify you again.')
  }
  if (plan.destroysKeyBackup) {
    willLose.push('Your key backup, permanently. The keys inside it are deleted, not archived -- there is no undo and no support path that recovers them.')
  }
  if (plan.losesBackedUpHistory) {
    willLose.push('Any message whose keys existed ONLY in that backup. Those become unreadable forever, on every device.')
  }
  if (plan.keepsLocalHistory) {
    willKeep.push('Every message this browser can already read. A reset does not clear this device -- do not clear your browser data afterwards.')
  }
  willKeep.push('Your account, your rooms, and everything sent in the clear.')
  willKeep.push('All future messages, once your devices are verified again.')
  return { willLose, willKeep }
}

export interface ResetGate {
  // D-e2: an export taken, or an explicit admission that one cannot be.
  exportedOrAcknowledged: boolean
  // D-e1: the user's own Matrix ID, typed by them.
  typedMatrixId: string
}

// Why the reset cannot proceed yet, in the user's terms. An empty list means
// the gate is open. Returning REASONS rather than a boolean is deliberate: a
// disabled button with no explanation is how a user concludes the app is broken
// and goes looking for a worse way to fix their problem.
export function gateBlockers(gate: ResetGate, userId: string, plan: ResetPlan): string[] {
  const out: string[] = []
  if (!plan.meaningful) {
    out.push('There is no encryption identity on this account to reset.')
    return out
  }
  if (!gate.exportedOrAcknowledged) {
    out.push('Save a key export first, or confirm you cannot make one.')
  }
  // Compared EXACTLY, trimmed only for surrounding whitespace. A Matrix ID's
  // localpart is case-sensitive, and accepting a near-miss would defeat the
  // point of asking someone to type it.
  if (gate.typedMatrixId.trim() !== userId) {
    out.push('Type your full Matrix ID exactly as shown to confirm.')
  }
  return out
}

export function gateSatisfied(gate: ResetGate, userId: string, plan: ResetPlan): boolean {
  return gateBlockers(gate, userId, plan).length === 0
}
