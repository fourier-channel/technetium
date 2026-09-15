import { DEFAULT_STATE_LEVEL } from './powerLevels'

// ---------------------------------------------------------------------------
// The whole server's shape, and what disagrees with itself (ui-depth-v1 U8).
//
// The operator asked for two things at once: every space and room's settings at
// a glance, and a way to "confirm that all rooms are always holding the correct
// settings and permissions". The second is the hard half, because nobody has
// ever written down what CORRECT is for this server.
//
// So this does not invent a policy. It reports two different kinds of thing and
// labels them differently, because they carry different weight:
//
//   HARD    true of any Matrix room regardless of anyone's taste. A room with
//           nobody at 100 cannot be administered by anyone, ever. A room whose
//           users_default is above 0 hands power to every new joiner. A room
//           where the power-levels event itself can be sent by anyone is a room
//           where anyone can take it over. These are faults.
//
//   OUTLIER this room disagrees with the rest of this server about a setting.
//           That is INFORMATION, not a fault, and it is never called one: a
//           deliberately public room in a private space is an outlier and is
//           also exactly right. The consensus is computed from the server's own
//           rooms, so it moves when the server does.
//
// An outlier needs a consensus to be an outlier FROM, and a consensus of two
// rooms is not one. Below MIN_FOR_CONSENSUS nothing is reported, and the panel
// says so rather than showing an empty list that looks like a clean bill.
//
// Pure, so the harness can load it (O-tp9). Everything here takes plain data;
// reading it out of the SDK happens at the call site.
// ---------------------------------------------------------------------------

export interface RoomUser {
  userId: string
  level: number
}

export interface RoomFacts {
  roomId: string
  name: string
  isSpace: boolean
  // True when this room is a direct message. DMs are excluded from the audit
  // entirely: a two-person room where both sides are at 100 is not a room with
  // a broken power structure, it is a DM.
  isDm: boolean
  // Ids of the spaces this room is a child of. Empty for an orphan.
  parentIds: string[]
  joinRule: string | null
  historyVisibility: string | null
  guestAccess: string | null
  encrypted: boolean
  memberCount: number
  usersDefault: number
  eventsDefault: number
  stateDefault: number
  invite: number
  kick: number
  ban: number
  redact: number
  // What the room requires to send m.room.power_levels.
  powerLevelsRequired: number
  users: RoomUser[]
}

export type FindingKind = 'hard' | 'outlier'

export interface Finding {
  kind: FindingKind
  roomId: string
  // The setting at issue, as a stable key.
  field: string
  // What is true, in the user's terms.
  what: string
  // Why it matters, or what the rest of the server does instead.
  why: string
}

// Fewer rooms than this and there is no "rest of the server" to disagree with.
export const MIN_FOR_CONSENSUS = 4

// ---------------------------------------------------------------------------
// Ordering. Alphabetical by name, then by id so the order is total -- two
// rooms called "general" would otherwise swap places between renders, which
// reads as the list flickering.
// ---------------------------------------------------------------------------
export function compareRooms(a: RoomFacts, b: RoomFacts): number {
  const byName = a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  if (byName !== 0) return byName
  return a.roomId.localeCompare(b.roomId)
}

// Ranked by power, descending, then alphabetical within a rank. The operator
// asked for both, and they are not in conflict: power is the primary key
// because the question is "who has any power above X here".
export function compareUsers(a: RoomUser, b: RoomUser): number {
  if (a.level !== b.level) return b.level - a.level
  return a.userId.toLowerCase().localeCompare(b.userId.toLowerCase())
}

// Who in this room holds a level inside the window. Inclusive at both ends: a
// floor of 50 is a question about moderators, and excluding exactly-50 would
// answer a different one.
export function usersInRange(room: RoomFacts, low: number, high: number): RoomUser[] {
  return room.users
    .filter((u) => u.level >= low && u.level <= high)
    .sort(compareUsers)
}

// The operator's default window. Low enough to catch a voiced user, high enough
// to include an owner.
export const DEFAULT_RANGE = { low: 10, high: 100 }

// A window with its ends the wrong way round is a typo, not a request for an
// empty list.
export function normaliseRange(low: number, high: number): { low: number; high: number } {
  const lo = Number.isFinite(low) ? Math.round(low) : DEFAULT_RANGE.low
  const hi = Number.isFinite(high) ? Math.round(high) : DEFAULT_RANGE.high
  return lo <= hi ? { low: lo, high: hi } : { low: hi, high: lo }
}

// ---------------------------------------------------------------------------
// The hard rules.
// ---------------------------------------------------------------------------
function hardFindings(room: RoomFacts): Finding[] {
  const out: Finding[] = []
  const f = (field: string, what: string, why: string) =>
    out.push({ kind: 'hard', roomId: room.roomId, field, what, why })
  const kind = room.isSpace ? 'space' : 'room'

  // A room nobody can administer. Not a style question: the power-levels event
  // is the only way back from any other mistake in this list, and without
  // somebody able to send it there is no way back at all.
  if (!room.users.some((u) => u.level >= 100)) {
    const top = room.users.reduce((m, u) => Math.max(m, u.level), 0)
    f(
      'no-admin',
      `Nobody in this ${kind} is at 100.`,
      top > 0
        ? `The highest anyone holds is ${top}, so nothing above that can ever be changed from inside.`
        : `Everybody is at the default, so nothing here can be changed from inside.`,
    )
  }

  // Everyone arrives with power.
  if (room.usersDefault > 0) {
    f(
      'users_default',
      `Everyone starts at ${room.usersDefault}.`,
      `A default above 0 gives every new joiner that level automatically, including anyone who joins tomorrow.`,
    )
  }

  // The event that governs every other event.
  if (room.powerLevelsRequired < DEFAULT_STATE_LEVEL) {
    f(
      'power_levels',
      `Power levels can be changed by anyone at ${room.powerLevelsRequired}.`,
      `That is the one event that governs all the others; below ${DEFAULT_STATE_LEVEL} it means the ${kind} can be taken over by anyone who reaches ${room.powerLevelsRequired}.`,
    )
  }
  // And the case where the requirement is at or below what everyone already
  // has, which is the same fault arriving by a different road.
  if (room.powerLevelsRequired <= room.usersDefault) {
    f(
      'power_levels',
      `Everyone can change the power levels.`,
      `The default level (${room.usersDefault}) already meets the requirement (${room.powerLevelsRequired}).`,
    )
  }

  if (room.guestAccess === 'can_join') {
    f('guest_access', `Guests can join.`, `Anyone can read and post here without an account.`)
  }

  // world_readable means the history is served to anyone who asks, account or
  // not. Reasonable for an announcement room that is also publicly joinable;
  // a fault anywhere else, because the room's own door says otherwise.
  if (room.historyVisibility === 'world_readable' && room.joinRule !== 'public') {
    f(
      'history_visibility',
      `History is world-readable, but the ${kind} is not public.`,
      `The door is shut and the window is open: anyone who learns the ${kind} id can read everything said in it without joining.`,
    )
  }

  return out
}

// ---------------------------------------------------------------------------
// Outliers, against the server's own consensus.
// ---------------------------------------------------------------------------
type Scalar = string | number | boolean | null

interface FieldSpec {
  field: string
  label: string
  read: (r: RoomFacts) => Scalar
}

const FIELDS: FieldSpec[] = [
  { field: 'join_rule', label: 'join rule', read: (r) => r.joinRule },
  { field: 'history_visibility', label: 'history visibility', read: (r) => r.historyVisibility },
  { field: 'guest_access', label: 'guest access', read: (r) => r.guestAccess },
  { field: 'encrypted', label: 'encryption', read: (r) => r.encrypted },
  { field: 'events_default', label: 'level to post', read: (r) => r.eventsDefault },
  { field: 'state_default', label: 'level to change settings', read: (r) => r.stateDefault },
  { field: 'invite', label: 'level to invite', read: (r) => r.invite },
  { field: 'kick', label: 'level to remove', read: (r) => r.kick },
  { field: 'ban', label: 'level to ban', read: (r) => r.ban },
  { field: 'redact', label: 'level to delete a message', read: (r) => r.redact },
]

function mode(values: Scalar[]): { value: Scalar; count: number } | null {
  const counts = new Map<string, { value: Scalar; count: number }>()
  for (const v of values) {
    const k = JSON.stringify(v)
    const e = counts.get(k)
    if (e) e.count++
    else counts.set(k, { value: v, count: 1 })
  }
  let best: { value: Scalar; count: number } | null = null
  for (const e of counts.values()) if (!best || e.count > best.count) best = e
  return best
}

function show(v: Scalar): string {
  if (v === null) return 'not set'
  if (typeof v === 'boolean') return v ? 'on' : 'off'
  return String(v)
}

// Spaces and rooms are compared only against their own kind: a space's join
// rule and a chat room's are not the same decision, and lumping them makes the
// smaller group outliers en masse.
function outlierFindings(rooms: RoomFacts[]): Finding[] {
  const out: Finding[] = []
  for (const isSpace of [false, true]) {
    const group = rooms.filter((r) => r.isSpace === isSpace)
    if (group.length < MIN_FOR_CONSENSUS) continue
    for (const spec of FIELDS) {
      const m = mode(group.map(spec.read))
      if (!m) continue
      // A STRICT MAJORITY, and that is doing more work than it looks. It is
      // also what makes ties impossible to mishandle: two settings used equally
      // often can never both clear it, so there is no tie-break to get wrong
      // and no iteration order to accidentally depend on. An earlier draft
      // carried an explicit tie-break as well; a mutation test showed it was
      // unreachable, so it is gone rather than sitting there looking load-
      // bearing.
      if (m.count * 2 <= group.length) continue
      for (const r of group) {
        const v = spec.read(r)
        if (JSON.stringify(v) === JSON.stringify(m.value)) continue
        out.push({
          kind: 'outlier',
          roomId: r.roomId,
          field: spec.field,
          what: `${spec.label} is ${show(v)}.`,
          why: `${m.count} of the other ${isSpace ? 'spaces' : 'rooms'} use ${show(m.value)}.`,
        })
      }
    }
  }
  return out
}

export interface Audit {
  findings: Finding[]
  // True when there were too few rooms for "the rest of the server" to mean
  // anything. The panel says so; an empty outlier list otherwise reads as a
  // clean bill of health, which is rule 8 of the doctrine exactly.
  consensusSkipped: boolean
  auditedRooms: number
  // DMs, counted and excluded. Named so the total is explicable.
  skippedDms: number
}

export function auditRooms(rooms: RoomFacts[]): Audit {
  const audited = rooms.filter((r) => !r.isDm)
  const findings: Finding[] = []
  for (const r of audited) findings.push(...hardFindings(r))
  const spaces = audited.filter((r) => r.isSpace).length
  const plain = audited.length - spaces
  const consensusSkipped = spaces < MIN_FOR_CONSENSUS && plain < MIN_FOR_CONSENSUS
  findings.push(...outlierFindings(audited))
  return {
    findings,
    consensusSkipped,
    auditedRooms: audited.length,
    skippedDms: rooms.length - audited.length,
  }
}

// Findings for one room, hard first: a fault and a difference of opinion should
// never be interleaved in a list somebody is skimming.
export function findingsFor(audit: Audit, roomId: string): Finding[] {
  return audit.findings
    .filter((f) => f.roomId === roomId)
    .sort((a, b) => (a.kind === b.kind ? a.field.localeCompare(b.field) : a.kind === 'hard' ? -1 : 1))
}

// The server's structure as a list: each space, then its children, then the
// orphans -- every level alphabetised. A room in two spaces appears under both,
// because it IS in both and showing it once would make one of the two lie.
export interface StructureRow {
  room: RoomFacts
  depth: number
  // The parent this row is being shown under, or null at the top level.
  underSpaceId: string | null
}

export function structure(rooms: RoomFacts[]): StructureRow[] {
  const byId = new Map(rooms.map((r) => [r.roomId, r]))
  const spaces = rooms.filter((r) => r.isSpace).sort(compareRooms)
  const out: StructureRow[] = []
  const placed = new Set<string>()

  for (const space of spaces) {
    // A space that is itself a child of another space is emitted under its
    // parent, not at the top.
    if (space.parentIds.some((p) => byId.has(p) && byId.get(p)!.isSpace)) continue
    emit(space, 0, null)
  }
  // Anything with no space above it that has not already been shown.
  for (const r of rooms.slice().sort(compareRooms)) {
    if (placed.has(r.roomId)) continue
    out.push({ room: r, depth: 0, underSpaceId: null })
    placed.add(r.roomId)
  }
  return out

  function emit(room: RoomFacts, depth: number, under: string | null): void {
    out.push({ room, depth, underSpaceId: under })
    placed.add(room.roomId)
    // A cycle in m.space.child is legal to write and would hang this. Depth is
    // the guard, because it bounds the walk without needing a visited set that
    // would also (wrongly) suppress a room genuinely living in two spaces.
    if (depth > 6) return
    const kids = rooms.filter((r) => r.parentIds.includes(room.roomId)).sort(compareRooms)
    for (const k of kids) emit(k, depth + 1, room.roomId)
  }
}
