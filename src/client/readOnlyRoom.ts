import { levelIn } from './powerLevels'

// ---------------------------------------------------------------------------
// A read-only room: members read, only moderators and bots post.
//
// It is nothing but power levels. `events_default: 50` puts every message
// (and every reaction) at moderator, so a member at 0 cannot send and the
// server refuses if they try. The 4chan lens board rooms are made this way
// (LIVE_4CHAN_LENS.md, ruling 5): only @sample, raised to 50, posts.
//
// Technetium's part is to not offer what the server will refuse: where this
// person may not send a message, the composer is replaced by one line saying
// why (Composer.tsx). Read from the room's raw power-levels content with the
// same rule every other power check here uses (levelIn: own entry, else
// users_default, else 0, and unlimited for a room-v12 creator).
// ---------------------------------------------------------------------------

/** The level the read-only option sets for sending messages. Moderator. */
export const READ_ONLY_LEVEL = 50

export const READ_ONLY_LINE = 'Read-only: only moderators and bots post here'

/**
 * The level a room asks for to send an m.room.message: its own entry under
 * `events`, else `events_default`, else 0 -- the spec's defaults, and what
 * the server enforces. A room with no power-levels event at all is 0.
 */
export function messageLevel(powerContent: unknown): number {
  const c = powerContent && typeof powerContent === 'object' ? (powerContent as Record<string, unknown>) : {}
  const events = c.events && typeof c.events === 'object' ? (c.events as Record<string, unknown>) : {}
  const own = events['m.room.message']
  if (typeof own === 'number' && Number.isInteger(own)) return own
  const d = c.events_default
  return typeof d === 'number' && Number.isInteger(d) ? d : 0
}

/** May this person send a message here? */
export function mayPostMessage(powerContent: unknown, userId: string, creators: readonly string[] = []): boolean {
  return levelIn(powerContent, userId, creators) >= messageLevel(powerContent)
}
