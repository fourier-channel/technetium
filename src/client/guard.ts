// ---------------------------------------------------------------------------
// Guard: what happens when something aimed at you finds a shield up.
//
// Every client works this out for itself, from the same guard event it already
// received (D-in09, the rule the splash follows too). The wire carries no
// "this was reflected" flag, because a sender who could set one could also
// clear it, and a shield you can talk your way past is not a shield.
//
// The consequence is a race, and it is the honest one: a client that never saw
// the guard event -- joined late, was offline for it -- plays the hostile action
// straight. That client is not wrong, it simply knows less. A handshake to fix
// it would cost more than the mismatch does.
//
// TWO DIFFERENT ANSWERS, because there are two different questions:
//   - HOSTILE aimed at a guarded person REFLECTS. It comes back at the sender,
//     which is the whole point of putting a guard up.
//   - Anything else is DEFLECTED, not refused: it plays at the edge of the
//     guarded person's space rather than reaching them. A hug should not be
//     punished for arriving while somebody is defensive.
//
// Pure, so the harness can load it (O-tp9).
// ---------------------------------------------------------------------------

export const GUARD_MS = 30_000

export interface GuardOutcome {
  actor: string
  target?: string
  /** The play came back at whoever sent it. */
  reflected: boolean
  /** It played, but stopped short of them. */
  deflected: boolean
}

export function guardActiveAt(guardedUntil: number | undefined, now: number): boolean {
  // A guard set in the FUTURE is not honoured, for the same reason the freshness
  // gate rejects future timestamps: a client choosing its own clock could
  // otherwise hold a shield up forever.
  if (guardedUntil === undefined) return false
  return now < guardedUntil && guardedUntil - now <= GUARD_MS
}

// `guardedUntil` is a lookup rather than a map so the caller keeps whatever
// storage it likes and this stays pure.
export function applyGuard(
  play: { actor: string; target?: string; hostile: boolean },
  guardedUntil: (userId: string) => number | undefined,
  now: number,
): GuardOutcome {
  const { actor, target } = play
  if (!target || !guardActiveAt(guardedUntil(target), now)) {
    return { actor, target, reflected: false, deflected: false }
  }
  if (!play.hostile) {
    return { actor, target, reflected: false, deflected: true }
  }
  // Reflected: it now travels FROM the guarded person BACK to the sender, which
  // is what "it came back at you" looks like. Swapping the ends reuses the
  // whole travel choreography rather than inventing a second one.
  //
  // Aiming a hostile action at YOURSELF while guarded does not reflect: there
  // is nowhere for it to come back from, and a play from you to you renders as
  // nothing at all.
  if (actor === target) {
    return { actor, target, reflected: false, deflected: true }
  }
  return { actor: target, target: actor, reflected: true, deflected: false }
}
