// ---------------------------------------------------------------------------
// m.room.member, read as something a person did rather than as an event type.
//
// These used to render as the literal string `[m.room.member]`, because
// classify() had no case for them and they fell through to the "unknown type"
// branch. They are the single most common non-message event in a room, so that
// placeholder was most of what a quiet room's log contained.
//
// This module is the pure half: what happened, to whom, and what to call it.
// The rendering (and the animation) lives in ui/MemberEvent.tsx.
//
// KEYED ON THE TRANSITION, NOT ON TEXT. The obvious approach is to match the
// rendered string ("X joined"), but that string is ours to change and is
// localisation-hostile; membership + prev_membership is the actual fact the
// server sends, and it distinguishes cases the text cannot (a leave you chose
// from one someone chose for you).
//
// No value imports, so the check harness can load it (O-tp9).
// ---------------------------------------------------------------------------

export type MemberTransition =
  | 'join'
  | 'leave'
  | 'kick'
  | 'ban'
  | 'unban'
  | 'invite'
  | 'knock'
  | 'rename'
  | 'avatar'
  | 'profile'
  | 'other'

// Only the fields read here; membership content carries plenty more.
export interface MemberContent {
  membership?: unknown
  displayname?: unknown
  avatar_url?: unknown
}

export interface MemberDescription {
  transition: MemberTransition
  // Does this get the sudden-appearance animation?
  //
  // ARRIVALS ONLY, deliberately. A ban or a kick rendered as a cheerful pop is
  // a moderation action made illegible, and a profile tweak animating every
  // time it scrolls past is noise. Keeping the effect to arrivals is also what
  // keeps it MEANING something: motion in the log means someone showed up.
  arrival: boolean
  // Best-known display name for the subject of the event.
  name: string
  // Previous display name, for a rename.
  prevName?: string
  // The subject's avatar as this event recorded it. The renderer prefers the
  // member's CURRENT avatar and falls back to this, so a long-scrolled log
  // shows people as they look now.
  avatarUrl: string | null
  // The subject (state_key), which is not always the sender: on a kick or a
  // ban the sender is the moderator.
  userId: string
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

export function describeMemberEvent(args: {
  content: MemberContent | null | undefined
  prevContent?: MemberContent | null
  sender?: string | null
  stateKey?: string | null
}): MemberDescription {
  const { content, prevContent, sender, stateKey } = args
  const membership = str(content?.membership)
  const previous = str(prevContent?.membership)
  const userId = str(stateKey) ?? ''

  const name =
    str(content?.displayname) ?? str(prevContent?.displayname) ?? (userId || 'someone')
  const prevName = str(prevContent?.displayname)
  const avatarUrl = str(content?.avatar_url) ?? str(prevContent?.avatar_url) ?? null

  let transition: MemberTransition = 'other'

  if (membership === 'join') {
    if (previous === 'join') {
      // Already in the room: this is a profile edit, not an arrival. Both
      // fields are compared because an event carries the WHOLE member state
      // every time, so "changed" means "differs from prev_content", not
      // "is present".
      const nameChanged = str(prevContent?.displayname) !== str(content?.displayname)
      const avatarChanged = str(prevContent?.avatar_url) !== str(content?.avatar_url)
      if (nameChanged && avatarChanged) transition = 'profile'
      else if (nameChanged) transition = 'rename'
      else if (avatarChanged) transition = 'avatar'
      else transition = 'other'
    } else {
      transition = 'join'
    }
  } else if (membership === 'invite') {
    transition = 'invite'
  } else if (membership === 'knock') {
    transition = 'knock'
  } else if (membership === 'ban') {
    transition = 'ban'
  } else if (membership === 'leave') {
    if (previous === 'ban') {
      // A ban is lifted by setting membership back to leave.
      transition = 'unban'
    } else if (sender && userId && sender !== userId) {
      // Someone else ended this membership.
      transition = 'kick'
    } else {
      transition = 'leave'
    }
  }

  return {
    transition,
    arrival: transition === 'join',
    name,
    prevName,
    avatarUrl,
    userId,
  }
}

// --- presentation vocabulary -------------------------------------------------

// Said AFTER the avatar pill, so none of these repeat the name -- the pill is
// already carrying it.
export const ARRIVAL_PHRASES: readonly string[] = [
  'appears!',
  'warps in.',
  'materializes.',
  'has entered the room.',
  'phases in.',
  'descends.',
  'blinks into existence.',
  'joins the party.',
]

// The sudden-appearance variants. Names match the CSS classes in index.css
// (.mev-<name>), so adding one here without a keyframe set renders a plain
// pill rather than breaking -- see the check that holds these in step.
export const ARRIVAL_ANIMATIONS: readonly string[] = [
  'poof',
  'warp',
  'slam',
  'sparkle',
  'glitch',
  'iris',
]

// Stable small hash. Same shape as NavTree's frHash: a per-event seed picks the
// phrase and the animation, so a given join always looks the same on replay
// while the log as a whole varies. A fresh random pick per replay would make
// the same row a different event each time it scrolled past, which reads as a
// glitch rather than as character.
export function seedHash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function pick<T>(items: readonly T[], seed: string, salt = 0): T {
  return items[(seedHash(seed) + salt) % items.length]
}

export function arrivalPhrase(seed: string): string {
  return pick(ARRIVAL_PHRASES, seed)
}

// A different salt from the phrase, so the two do not move in lockstep across
// the list (every "appears!" always poofing would read as one animation).
export function arrivalAnimation(seed: string): string {
  return pick(ARRIVAL_ANIMATIONS, seed, 7)
}

// The quiet, static line for everything that is not an arrival.
export function memberPhrase(d: MemberDescription, seed: string): string {
  switch (d.transition) {
    case 'join':
      return arrivalPhrase(seed)
    case 'leave':
      return 'left the room.'
    case 'kick':
      return 'was removed.'
    case 'ban':
      return 'was banned.'
    case 'unban':
      return 'was unbanned.'
    case 'invite':
      return 'was invited.'
    case 'knock':
      return 'asked to join.'
    case 'rename':
      return d.prevName ? `was ${d.prevName}.` : 'changed their name.'
    case 'avatar':
      return 'changed their avatar.'
    case 'profile':
      return 'updated their profile.'
    default:
      return 'updated their membership.'
  }
}
