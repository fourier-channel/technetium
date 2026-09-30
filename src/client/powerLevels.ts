import { reportIgnored } from './report'

// ---------------------------------------------------------------------------
// Setting someone's power level in a room (ui-depth-v1 U7).
//
// The rules are the homeserver's, not this client's, and getting them wrong
// does not produce a wrong answer -- it produces a button that looks live and
// then 403s, which is worse than no button. So they are stated once, here,
// where a check can hold them, and the panel only renders what this returns.
//
// What Synapse actually enforces on an m.room.power_levels change:
//
//   1. You must clear the level required to SEND that state event. Usually 50,
//      from the room's own `events['m.room.power_levels']`, falling back to
//      `state_default`, falling back to 50.
//   2. You may not set anyone ABOVE your own level.
//   3. You may not change the level of anyone already AT or above your own --
//      with one exception: you may always lower your OWN.
//
// Rule 3's exception is the one worth a comment. An owner can step down. They
// cannot step back up afterwards, because rule 2 then applies to the person
// they have become, and there is no undo anywhere in Matrix for it. The panel
// says so before the click rather than after.
//
// Pure, so the harness can load it (O-tp9).
// ---------------------------------------------------------------------------

export interface Tier {
  level: number
  label: string
}

// The four the rest of the client already speaks: honorificFor() in members.ts
// maps exactly these thresholds to ~, @ and +, and the member list draws them.
// A fifth tier here would be a rank with no glyph.
export const TIERS: readonly Tier[] = [
  { level: 0, label: 'Member' },
  { level: 25, label: 'Voice' },
  { level: 50, label: 'Moderator' },
  { level: 100, label: 'Owner' },
]

// The spec's fallback when a room names no requirement of its own.
export const DEFAULT_STATE_LEVEL = 50

export interface PowerInput {
  // Is the card showing the signed-in user?
  isSelf: boolean
  // Is there a room in hand at all? The member list can be open with no room
  // selected, and a power level is a property of a room.
  haveRoom: boolean
  // Is the target a member of THAT room? Somebody visible in the "All" list may
  // hold no membership here, and Matrix will happily write a power level for a
  // user who is not in the room -- which reads as working and does nothing
  // anybody can see.
  inRoom: boolean
  myLevel: number
  targetLevel: number
  // What the room requires to send m.room.power_levels.
  requiredToSet: number
  // Spaces and rooms are the same object here; only the wording differs.
  isSpace: boolean
}

export interface PowerFacts {
  current: number
  // The tiers this user may assign right now. Empty when blocked.
  options: Tier[]
  // Null when the control is live; otherwise why it is not, in the user's own
  // terms. Never "you cannot do that" on its own -- an error names its remedy.
  blocked: string | null
  // Shown beside a live control: something true that the click cannot undo.
  warning: string | null
}

// The rules above, for ONE change. The one-room editor below and the bulk
// setter (bulkPower.ts) both ask these, so the homeserver's rules are written
// once (D-tc01).
export type RuleInput = Pick<PowerInput, 'isSelf' | 'myLevel' | 'targetLevel' | 'requiredToSet' | 'isSpace'>

// Rules 1 and 3: may you change this person's level at all. Null when you may.
export function standing(i: RuleInput): string | null {
  const where = i.isSpace ? 'space' : 'room'
  if (i.myLevel < i.requiredToSet) {
    return `Changing levels in this ${where} needs power level ${i.requiredToSet}; you have ${i.myLevel}. Ask someone at ${i.requiredToSet} or above.`
  }
  // You may always lower your own, and that is the only thing you may do to
  // somebody standing at your own height.
  if (!i.isSelf && i.targetLevel >= i.myLevel) {
    return `They are at level ${i.targetLevel} and you are at ${i.myLevel}. You can only change someone below you.`
  }
  return null
}

// Rule 2 on top of those: may you set them to THIS level. Null when the
// homeserver would accept it.
export function refusal(i: RuleInput, to: number): string | null {
  // Canonical JSON has no floats (G-bf04), so the server rejects one outright.
  if (!Number.isInteger(to)) return `A power level is a whole number, and ${to} is not one.`
  const s = standing(i)
  if (s) return s
  if (to > i.myLevel) {
    const where = i.isSpace ? 'space' : 'room'
    return `Level ${to} is above your own (${i.myLevel}) in this ${where}, and nobody can give a level higher than their own.`
  }
  return null
}

export function powerEdit(i: PowerInput): PowerFacts {
  const where = i.isSpace ? 'space' : 'room'
  const none: Omit<PowerFacts, 'blocked'> = { current: i.targetLevel, options: [], warning: null }

  if (!i.haveRoom) {
    return { ...none, blocked: `Open a ${where} to set someone's level in it -- a power level belongs to one ${where}, not to the account.` }
  }
  if (!i.inRoom) {
    return { ...none, blocked: `They are not in this ${where}, so they have no level here. Invite them first.` }
  }
  const blocked = standing(i)
  if (blocked) return { ...none, blocked }

  const options = TIERS.filter((t) => refusal(i, t.level) === null)

  if (i.isSelf) {
    return {
      ...none,
      // Self-demotion only: setting your own level to your own level is a
      // no-op, and above it is refused, so the list is what is below you.
      options: options.filter((t) => t.level < i.myLevel),
      blocked: options.filter((t) => t.level < i.myLevel).length === 0
        ? `You are at level ${i.myLevel}; there is nothing below it to step down to.`
        : null,
      warning: `Stepping down is permanent. Nobody at your new level can put you back, and you would need someone above it to do it for you.`,
    }
  }

  return {
    current: i.targetLevel,
    options,
    blocked: options.length === 0 ? `You are at level ${i.myLevel}, which is below every rank this client offers.` : null,
    warning: options.some((t) => t.level === i.myLevel)
      ? `Setting someone to your own level (${i.myLevel}) means you can no longer change it back.`
      : null,
  }
}

// What a room requires to send m.room.power_levels, read from the content of
// its m.room.power_levels event. Defensive about every field, because this is
// server data and a room whose power_levels event is malformed must not read
// as "anyone may do anything".
export function requiredToSetPower(content: unknown): number {
  if (!content || typeof content !== 'object') return DEFAULT_STATE_LEVEL
  const c = content as Record<string, unknown>
  const events = c.events
  if (events && typeof events === 'object') {
    const v = (events as Record<string, unknown>)['m.room.power_levels']
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  const sd = c.state_default
  if (typeof sd === 'number' && Number.isFinite(sd)) return sd
  return DEFAULT_STATE_LEVEL
}

// ---------------------------------------------------------------------------
// Reading and writing the event itself, for code that holds raw content
// rather than the SDK's member objects (the bulk setter, which reads each room
// fresh from the server before it writes).
// ---------------------------------------------------------------------------

// Room version 12 onward ("hydra", MSC4289): whoever created the room, and
// anyone the create event names in `additional_creators`, holds unlimited
// power. They are never listed in `users` -- the server refuses a
// power-levels event that lists them -- and nobody can change their level.
// The SDK computes member levels by this rule (models/room-state.js,
// getCreators); this is the same rule for raw content. The list is the SDK's
// own, and a check holds the two equal: an unknown version is hydra, as the
// SDK treats it, and a create event naming no version is version 1, as the
// spec says.
export const PRE_HYDRA_ROOM_VERSIONS: readonly string[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']

export function hydraCreators(roomVersion: unknown, createSender: string | null | undefined, createContent: unknown): string[] {
  const version = typeof roomVersion === 'string' ? roomVersion : '1'
  if (PRE_HYDRA_ROOM_VERSIONS.includes(version)) return []
  const out = new Set<string>()
  if (createSender) out.add(createSender)
  const extra = (createContent as { additional_creators?: unknown } | null)?.additional_creators
  if (Array.isArray(extra)) for (const c of extra) if (typeof c === 'string') out.add(c)
  return [...out]
}

// One person's level in a room, from the power-levels content: their own
// entry, else the room's default, else 0 -- and unlimited for a creator.
export function levelIn(content: unknown, userId: string, creators: readonly string[] = []): number {
  if (creators.includes(userId)) return Infinity
  const c = content && typeof content === 'object' ? (content as Record<string, unknown>) : {}
  const users = c.users && typeof c.users === 'object' ? (c.users as Record<string, unknown>) : {}
  const own = users[userId]
  if (typeof own === 'number' && Number.isInteger(own)) return own
  const d = c.users_default
  return typeof d === 'number' && Number.isInteger(d) ? d : 0
}

// The content with ONE person's level changed and nothing else. A
// power-levels event is replaced whole on every write -- Matrix has no patch
// -- so a key this failed to carry over is a key the write deletes: a custom
// event's requirement in `events`, somebody else's rank, the notification
// levels. Copied, never mutated, because the input is usually the SDK's own
// state and a failed write must leave it as it was.
export function withUserLevel(content: Record<string, unknown>, userId: string, level: number): Record<string, unknown> {
  const copy = structuredClone(content)
  const users = copy.users && typeof copy.users === 'object' ? (copy.users as Record<string, unknown>) : {}
  users[userId] = level
  copy.users = users
  return copy
}

// What a refused or failed change says, in terms of POWER. This used to go
// through describeInviteError, so a 403 on a promotion read "You do not have
// permission to invite people to this room".
export function describePowerError(err: unknown, isSpace = false): string {
  const where = isSpace ? 'space' : 'room'
  const e = err as { errcode?: string; httpStatus?: number; message?: string; data?: { error?: unknown } } | null
  if (e?.errcode === 'M_LIMIT_EXCEEDED' || e?.httpStatus === 429) {
    return 'The server is limiting how fast changes can be made. Wait a few seconds and try again.'
  }
  const said = typeof e?.data?.error === 'string' && e.data.error ? ` It said: "${e.data.error}"` : ''
  if (e?.errcode === 'M_FORBIDDEN' || e?.httpStatus === 403) {
    return `The server refused the change.${said} Re-read, check your level in this ${where} and theirs, and try again.`
  }
  if (e?.errcode === 'M_NOT_FOUND' || e?.httpStatus === 404) {
    return `The server does not know this ${where} any more.${said}`
  }
  if (e?.httpStatus === undefined && !e?.errcode) {
    return 'The server could not be reached. Nothing was changed that this can see; try again when you are back online.'
  }
  return `The change failed.${said || (e?.message ? ` ${e.message}` : '')}`
}

// How long a rate-limited request asks us to wait, or null when it was not
// rate-limited. The SDK's MatrixError knows the header and the body field
// both; a plain object from a check carries retry_after_ms.
export function rateLimitWaitMs(err: unknown): number | null {
  const e = err as { errcode?: string; httpStatus?: number; getRetryAfterMs?: () => number | null; data?: { retry_after_ms?: unknown } } | null
  if (!(e?.errcode === 'M_LIMIT_EXCEEDED' || e?.httpStatus === 429)) return null
  try {
    const ms = typeof e.getRetryAfterMs === 'function' ? e.getRetryAfterMs() : null
    if (typeof ms === 'number' && Number.isFinite(ms)) return ms
  } catch (err) {
    // A malformed Retry-After header. The body field, or the caller's default,
    // still gives a wait, so this is recorded and passed over (G-tc05).
    reportIgnored('power: unreadable Retry-After', err)
  }
  const body = e.data?.retry_after_ms
  return typeof body === 'number' && Number.isFinite(body) ? body : 0
}
