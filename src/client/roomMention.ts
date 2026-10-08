import { levelIn } from './powerLevels'

// ---------------------------------------------------------------------------
// @room (launch-polish L28, operator 2026-10-08: "I don't seem to be able to
// do @room or anything from Technetium").
//
// What the server does, measured against Synapse 1.152.1 (production's
// version) from a third member's point of view before any of this was written:
//
//   typed "@room", no m.mentions ............................ ping
//   "@room" with m.mentions.room ............................ ping
//   "@room" and a picked person (m.mentions user_ids only) .. NO ping
//   "@room" in a reply (which carries m.mentions) ........... NO ping
//   "@room" in a picture's caption, no m.mentions ........... ping
//   m.mentions.room from a member below the room's level .... NO ping
//
// Since MSC3952 a message carrying m.mentions is judged by m.mentions ALONE:
// the old "the body says @room" rule stops applying to it. This client sent
// m.mentions with every picked name and every reply and never set `room`, so
// @room worked only in a message that mentioned nobody else and answered
// nothing -- and the composer offered it nowhere.
//
// Pure, so the check suite can hold every rule here without a homeserver.
// ---------------------------------------------------------------------------

export const ROOM_MENTION = '@room'

// The room's own word, and the two a Discord hand types for the same thing.
// Each brings up the one entry, which always inserts "@room": that is the
// word other Matrix clients and the server's own fallback rule recognise.
const ROOM_WORDS = ['room', 'everyone', 'here']

// Does the `@` query in the composer bring up the @room entry?
export function offersRoomMention(query: string): boolean {
  const q = query.toLowerCase()
  return ROOM_WORDS.some((w) => w.startsWith(q))
}

// "@room" as a word of its own: not "@roommate", not inside an address or a
// user id, and not the tail of a longer @-token.
const ROOM_RE = /(^|[^\w@#.:/-])@room(?![\w:@-])/

export function containsRoomMention(text: string): boolean {
  return ROOM_RE.test(text)
}

export interface RoomMentionPermission {
  allowed: boolean
  // The room's level for notifying everyone (power levels
  // notifications.room; 50 when the room says nothing, as the spec has it).
  need: number
  // The person's level; Infinity for a room-version-12 creator.
  have: number
}

export function roomMentionPermission(
  powerContent: unknown,
  userId: string,
  creators: readonly string[] = [],
): RoomMentionPermission {
  const c = powerContent && typeof powerContent === 'object' ? (powerContent as Record<string, unknown>) : {}
  const n = c.notifications && typeof c.notifications === 'object' ? (c.notifications as Record<string, unknown>) : {}
  const need = typeof n.room === 'number' && Number.isInteger(n.room) ? n.room : 50
  const have = levelIn(powerContent, userId, creators)
  return { allowed: have >= need, need, have }
}

// What the picker says when @room is offered but this person cannot use it.
// A disabled entry with no reason reads as a broken one.
export function roomMentionRefusal(p: RoomMentionPermission): string {
  return `Notifying everyone here needs level ${p.need}; yours is ${p.have}.`
}

export type MentionsBlock = { 'm.mentions'?: { user_ids?: string[]; room?: true } }

// The m.mentions to send. Empty when there is nothing to say, so a message
// that mentions nobody stays the shape it always was.
export function mentionsBlock(userIds: Iterable<string>, room: boolean): MentionsBlock {
  const ids = [...new Set(userIds)]
  if (ids.length === 0 && !room) return {}
  return {
    'm.mentions': {
      ...(ids.length > 0 ? { user_ids: ids } : {}),
      ...(room ? { room: true as const } : {}),
    },
  }
}

// Does this message call on ME? The same questions the server's push rules
// ask, so a row is marked exactly when the room list's "@" lit for it:
// m.mentions when the message carries it, and otherwise the old fallbacks --
// "@room" in the body, or a link to me in the formatted body. `senderMayRoom`
// is asked only when the answer depends on it.
//
// Not reproduced: the server's display-name fallback (a body containing my
// name with no m.mentions). It is the rule MSC3952 exists to retire, and
// guessing at someone's name in free text marks rows nobody meant.
export function mentionsMe(
  content: Record<string, unknown> | null | undefined,
  me: string,
  senderMayRoom: () => boolean,
): boolean {
  if (!content || !me) return false
  const m = content['m.mentions']
  if (m && typeof m === 'object') {
    const mm = m as Record<string, unknown>
    if (Array.isArray(mm.user_ids) && mm.user_ids.includes(me)) return true
    return mm.room === true && senderMayRoom()
  }
  const body = typeof content.body === 'string' ? content.body : ''
  if (containsRoomMention(body) && senderMayRoom()) return true
  const html = typeof content.formatted_body === 'string' ? content.formatted_body : ''
  return (
    html.includes(`matrix.to/#/${me}"`) ||
    html.includes(`matrix.to/#/${encodeURIComponent(me)}"`) ||
    html.includes(`matrix:u/${me.slice(1)}"`)
  )
}
