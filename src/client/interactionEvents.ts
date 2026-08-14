import { interactionById, type InteractionDef, type InteractionSurface } from './interactionCatalog'

// ---------------------------------------------------------------------------
// The interaction wire, and every rule about whether to believe it.
//
// Pure, so the harness can load it (O-tp9) -- which matters here more than
// usual, because the rules below are the ones that stop a hostile or buggy
// client making everyone else's chat unusable, and "I read the code carefully"
// is not evidence for that.
//
// Wire shape (PL0 timeline event, net.41chan.interaction):
//
//     { id: string, action: string, target?: string }
//
// Note what is NOT on the wire: who did it. The actor is always the event's
// SENDER (D-in02). An actor field would let anyone author a slap "from" anyone
// else -- the same forged-authority hole that edits (an m.replace honoured only
// from the original sender) and polls (only the creator may end one) had to
// close. There is no reason to open a third.
// ---------------------------------------------------------------------------

export const INTERACTION_EVENT = 'net.41chan.interaction'

// Only animate interactions this fresh. Older ones are history, not live
// triggers: opening a room must not replay a burst of yesterday's slaps.
export const FRESH_WINDOW_MS = 8_000

// One interaction per sender per this long, enforced by the RECEIVER as well
// as by the sender's own UI (D-in03). A client that ignores its own limit --
// or is patched not to have one -- cannot flood anybody else's screen.
export const RATE_LIMIT_MS = 3_000

// A target is a user id. Not validated beyond shape and length: the renderer
// resolves it to an on-screen anchor and simply does not play when it cannot,
// so a nonsense value is inert rather than dangerous. The cap is here so a
// megabyte of "target" cannot ride along in state.
const MAX_TARGET_LEN = 255

export interface ParsedInteraction {
  // Instance identity, for dedup against our own echo.
  key: string
  action: string
  def: InteractionDef
  actor: string
  target?: string
}

function str(v: unknown, max = 512): string | undefined {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined
}

export function parseInteraction(args: {
  content: unknown
  sender: string | null | undefined
  eventId: string | null | undefined
  ts: number
  now: number
  surface: InteractionSurface
}): ParsedInteraction | null {
  const { content, sender, eventId, ts, now, surface } = args

  // D-in02: no sender, no interaction. Never read an actor from content.
  const actor = str(sender)
  if (!actor) return null

  if (!content || typeof content !== 'object') return null
  const c = content as Record<string, unknown>

  const action = str(c.action, 64)
  if (!action) return null

  const def = interactionById(action)
  if (!def) return null
  // An action the other surface owns must not play here: a canvas throw has
  // nowhere to land in a chat log.
  if (!def.surfaces.includes(surface)) return null

  // Freshness. Also rejects the future: a client with a skewed clock (or one
  // choosing its own ts) must not be able to pin an animation on screen by
  // dating it forward.
  const age = now - ts
  if (!Number.isFinite(age) || age > FRESH_WINDOW_MS || age < -FRESH_WINDOW_MS) return null

  const target = str(c.target, MAX_TARGET_LEN)
  // A targeted interaction without a target has nothing to travel to, and a
  // self interaction carrying one is either confused or probing. Both are
  // rejected rather than coerced, so the renderer's invariant holds: shape
  // 'targeted' always has a target, 'self' never does.
  if (def.shape === 'targeted' && !target) return null
  if (def.shape === 'self' && target) return null

  const key = str(c.id, 128) ?? str(eventId, 128)
  if (!key) return null

  return { key, action, def, actor, target }
}

// Per-sender rate limit. `lastAt` is when that sender's previous interaction
// was ACCEPTED, not when it was sent.
export function rateLimitOk(lastAt: number | undefined, now: number): boolean {
  if (lastAt === undefined) return true
  const since = now - lastAt
  // A backwards clock jump must not unlock the gate.
  if (since < 0) return false
  return since >= RATE_LIMIT_MS
}
