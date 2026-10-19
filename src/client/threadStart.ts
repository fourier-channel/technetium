// Who may START a thread on a message: power level 49 by default (operator,
// 2026-10-19: "make it 49 to make threads"); replying in a thread that already
// exists is open to anyone who may post.
//
// The SERVER is the control: fourier-basis ops/hetzner/synapse/modules/
// thread_start_policy.py refuses a thread start below the level, whatever
// client sent it. This is Technetium asking the same question of the same
// place -- the room's power levels -- so the verb is offered exactly where the
// server would accept it. The two read the level identically: the room's
// `events["net.41chan.thread_start"]` when set, else 49. One difference by
// necessity: the server also lets a server admin through, which a client
// cannot see.
import type { MatrixEvent, Room } from 'matrix-js-sdk'

export const THREAD_START_EVENT = 'net.41chan.thread_start'
export const DEFAULT_THREAD_START_LEVEL = 49

// Ints, or numeric strings as old rooms carry them; anything else is the
// default -- never "anyone".
function asLevel(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v)) return v
  if (typeof v === 'string' && /^\s*-?\d+\s*$/.test(v)) return Number.parseInt(v, 10)
  return null
}

export function threadStartLevel(powerLevels: unknown): number {
  const events = (powerLevels as { events?: unknown } | null | undefined)?.events
  if (events && typeof events === 'object' && THREAD_START_EVENT in events) {
    return asLevel((events as Record<string, unknown>)[THREAD_START_EVENT]) ?? DEFAULT_THREAD_START_LEVEL
  }
  return DEFAULT_THREAD_START_LEVEL
}

export function canStartThreads(room: Room | null | undefined, userId: string | null | undefined): boolean {
  if (!room || !userId) return false
  const me = room.getMember(userId)
  if (!me) return false
  const pl = room.currentState.getStateEvents('m.room.power_levels', '')?.getContent()
  return me.powerLevel >= threadStartLevel(pl)
}

// Which messages a thread can be started on: not one that already has a
// thread (its chip opens that), not a reply inside one (threads do not nest),
// not a local echo (no id the server knows yet).
export function mayOfferStartThread(event: MatrixEvent): boolean {
  const id = event.getId()
  if (!id || id.startsWith('~')) return false
  if (event.isThreadRoot) return false
  if (event.threadRootId) return false
  return true
}
