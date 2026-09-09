// ---------------------------------------------------------------------------
// What a newly created DM says about itself, once.
//
// E9 owed this. `dmEncryptionNotice` has existed since E4 and had NO caller,
// so `startDm` decided whether to encrypt, returned the decision, and nothing
// ever showed it. A DM created quietly in the clear -- because the other party
// is a bot with no keys, or because the device list could not be read -- looked
// exactly like one created encrypted. That is the precise failure E10 forbids:
// the user believing they have a guarantee they do not have.
//
// SCOPE, deliberately narrow. This is the REASON, stated at creation, and it
// is transient: it lives in memory, it is dismissible, and it does not survive
// a reload. The ONGOING truth is the shield badge (E10's `roomShield`), which
// is derived from room state and is always correct. Persisting this as well
// would give a room two sources for the same claim that could disagree, and
// the derived one is the one to trust.
//
// Only NEW rooms get one. `startDm` returns `encryption: null` for a
// conversation that already existed, because no decision was made -- and
// inventing a notice for it would be reporting a choice nobody took.
//
// No browser APIs, so the harness can drive it (O-tp9).
// ---------------------------------------------------------------------------

import type { DmEncryptionDecision } from './dmEncryption'

const notices = new Map<string, DmEncryptionDecision>()
const listeners = new Set<() => void>()

function announce(): void {
  for (const fn of listeners) fn()
}

export function recordDmNotice(roomId: string, decision: DmEncryptionDecision | null): void {
  // null is "no decision was made" -- an existing room. Not an absent notice
  // to be filled in later, and not an error.
  if (!decision) return
  notices.set(roomId, decision)
  announce()
}

// The DECISION, not the sentence. The caller renders it, so asking "was this
// encrypted?" never becomes a string match on the first words of a notice.
export function dmNoticeFor(roomId: string): DmEncryptionDecision | null {
  return notices.get(roomId) ?? null
}

export function dismissDmNotice(roomId: string): void {
  if (notices.delete(roomId)) announce()
}

export function subscribeDmNotice(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

// The harness needs to start from empty; nothing in the app calls this.
export function resetDmNoticesForTest(): void {
  notices.clear()
  listeners.clear()
}
