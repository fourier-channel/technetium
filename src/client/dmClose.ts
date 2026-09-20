import { EventType, type MatrixClient } from 'matrix-js-sdk'
import { readDirectMap } from './dm'

// ---------------------------------------------------------------------------
// Closing a conversation.
//
// A DM window had no way to close. Removing the other person did not do it --
// the room stayed, and it stayed the answer for "a DM with them" -- so a
// conversation could be finished in every sense except the one the screen
// showed.
//
// CLOSING IS LEAVING, and that is the honest meaning rather than a tidy-up.
// You lose access to the room's media, because media in a Matrix room is
// readable by its members and you have stopped being one. The operator's
// words, 2026-09-20: "which is appropriate, given that they are closing a
// window."
//
// WHAT IT DOES NOT DO IS DELETE ANYTHING. The room goes on existing with its
// history in it, and the other person keeps both. This matters for the warning
// below: "closed" must not be read as "erased", by the person closing it or by
// anyone reasoning about what the other party can still see.
// ---------------------------------------------------------------------------

export interface DmCloseWarning {
  /** What closing costs, in the order it costs it. */
  losses: string[]
  /** What closing does NOT do -- said, because "closed" reads as "erased". */
  keeps: string[]
}

/**
 * What to tell somebody before they close a conversation.
 *
 * Every line is a fact about Matrix, not a reassurance:
 *
 * - A new DM is a NEW ROOM. Nothing carries history into it, ever. This is the
 *   question that prompted the feature and the answer is flatly no.
 * - The old room still has the history, and the other person still has the
 *   room. Leaving is one-sided.
 * - These DMs are made with the trusted_private_chat preset, whose history
 *   visibility is "shared" -- so if they invite you back to THAT room, you see
 *   all of it again. That is the only route back, and it is theirs to offer.
 */
export function dmCloseWarning(who: string): DmCloseWarning {
  return {
    losses: [
      `You leave this room. Its messages and pictures stop being readable to you, including ones you sent.`,
      `Starting a new conversation with ${who} creates a NEW room. This history will not be in it, and nothing can put it there.`,
    ],
    keeps: [
      `Nothing is deleted. ${who} keeps this room and everything in it.`,
      `If ${who} invites you back to this same room, you will see the whole history again.`,
    ],
  }
}

/**
 * What the destructive item in a room's context menu says.
 *
 * A pure function rather than an expression inside JSX, because the WORD is
 * the feature here: "Leave room" on a DM describes a third of what happens,
 * and a string buried in a ternary is a string no check can hold to account.
 */
export type RoomKind = 'space' | 'dm' | 'room'

export function leaveLabel(kind: RoomKind): string {
  if (kind === 'space') return 'Leave space'
  // Leaving is the act; closing is what it means for a conversation. Both are
  // named, in the order they happen.
  if (kind === 'dm') return 'Leave and Close'
  return 'Leave room'
}

export function leaveConfirmLabel(kind: RoomKind): string {
  // The confirm repeats the VERB rather than saying "confirm", so the second
  // click is still a sentence about what is about to happen.
  return kind === 'dm' ? 'Click again to leave and close' : 'Click again to confirm'
}

export interface CloseDmResult {
  left: boolean
  /** Best-effort: leaving is what matters, forgetting is tidiness. */
  forgotten: boolean
  /** Removed from m.direct, so it is no longer offered as an existing DM. */
  pruned: boolean
  /** Present when something did not happen. Never thrown away. */
  problem?: string
}

/**
 * Leave the room, forget it, and take it out of m.direct.
 *
 * THE ORDER IS THE CONTRACT. Leaving is the act; everything after it is
 * bookkeeping. If the leave fails, nothing else happens and the room is left
 * exactly as it was -- a half-close that pruned account data would hide a room
 * the user is still in, which is worse than not closing it.
 *
 * Forgetting is best-effort and its failure is reported, not swallowed: the
 * room is genuinely left either way, and the only consequence is that it may
 * still appear somewhere as a room you have left.
 */
export async function closeDm(client: MatrixClient, roomId: string): Promise<CloseDmResult> {
  try {
    await client.leave(roomId)
  } catch (err) {
    return { left: false, forgotten: false, pruned: false, problem: describe(err) }
  }

  let forgotten = false
  let problem: string | undefined
  try {
    await client.forget(roomId)
    forgotten = true
  } catch (err) {
    problem = `left the room, but could not forget it: ${describe(err)}`
  }

  let pruned = false
  try {
    pruned = await pruneFromDirect(client, roomId)
  } catch (err) {
    const note = `left the room, but could not update m.direct: ${describe(err)}`
    problem = problem ? `${problem}; ${note}` : note
  }

  return { left: true, forgotten, pruned, problem }
}

/**
 * Take a room out of m.direct, under every user it is listed for.
 *
 * Under EVERY user rather than one: the map is account data that other clients
 * write too, and a room listed twice would come back as an "existing DM" from
 * the entry nobody looked at. A user left with no rooms loses their key, so the
 * map does not accumulate empty lists forever.
 *
 * @returns whether anything changed.
 */
export async function pruneFromDirect(client: MatrixClient, roomId: string): Promise<boolean> {
  const map = readDirectMap(client)
  const next: Record<string, string[]> = {}
  let changed = false
  for (const [userId, rooms] of Object.entries(map)) {
    const kept = rooms.filter((r) => r !== roomId)
    if (kept.length !== rooms.length) changed = true
    if (kept.length) next[userId] = kept
  }
  if (!changed) return false
  await client.setAccountData(EventType.Direct, next)
  return true
}

function describe(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
  return String(err)
}
