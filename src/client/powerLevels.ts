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

export function powerEdit(i: PowerInput): PowerFacts {
  const where = i.isSpace ? 'space' : 'room'
  const none: Omit<PowerFacts, 'blocked'> = { current: i.targetLevel, options: [], warning: null }

  if (!i.haveRoom) {
    return { ...none, blocked: `Open a ${where} to set someone's level in it -- a power level belongs to one ${where}, not to the account.` }
  }
  if (!i.inRoom) {
    return { ...none, blocked: `They are not in this ${where}, so they have no level here. Invite them first.` }
  }
  if (i.myLevel < i.requiredToSet) {
    return {
      ...none,
      blocked: `Changing levels in this ${where} needs power level ${i.requiredToSet}; you have ${i.myLevel}. Ask someone at ${i.requiredToSet} or above.`,
    }
  }
  // You may always lower your own, and that is the only thing you may do to
  // somebody standing at your own height.
  if (!i.isSelf && i.targetLevel >= i.myLevel) {
    return {
      ...none,
      blocked: `They are at level ${i.targetLevel} and you are at ${i.myLevel}. You can only change someone below you.`,
    }
  }

  const options = TIERS.filter((t) => t.level <= i.myLevel)

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
