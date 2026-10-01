import {
  creatorRefusal,
  describePowerError,
  levelIn,
  rateLimitWaitMs,
  refusal,
  requiredToSetPower,
  withUserLevel,
} from './powerLevels'
import type { RoomFacts } from './serverPermissions'

// ---------------------------------------------------------------------------
// One person, one level, many rooms (launch-polish L19).
//
// Operator, 2026-09-30: "I need a new server permissions menu option to set a
// given user to a given power level in multiple rooms at a time. it's a pain
// to go down through each channel just to set global mods."
//
// Two halves, both pure so the check suite drives them (O-tp9):
//
//   judgeRoom  what setting them would do in one room, from plain facts, by
//              the same rules as the one-room editor (powerLevels.refusal).
//   runBulk    the writes, one room at a time, each from a FRESH read of that
//              room's power levels -- never from what the preview saw.
//
// Why fresh. A power-levels event is replaced whole on every write; Matrix has
// no patch. A write built from a copy that is a minute old deletes whatever
// changed in that minute -- another admin's promotion, a bot's grant for a
// custom event -- and reports success. The preview is for deciding; the write
// reads again, judges again, and says so when the answer moved.
//
// Rooms they have not joined are offered, labelled. Matrix keeps a level for
// anyone named in the event, member or not, and it applies the moment they
// join -- which is the point for somebody being made a moderator everywhere,
// rooms they have not visited yet included. The one-room editor refuses a
// non-member for a different reason (there the person is chosen out of a list
// of members, so a non-member means the list was wrong); here the row says
// what will happen, before anything is written.
//
// Your own level is not set from here. Stepping down is the one change nobody
// below you can undo, and doing it in every room at once is not a thing to
// reach by picking your own name out of a list. The one-room editor still
// lets you, one room at a time.
// ---------------------------------------------------------------------------

export type Membership = 'join' | 'invite' | 'knock' | 'leave' | 'ban' | 'none'

// A membership read that failed is not a membership: the row says why and
// nothing is written there until a re-read succeeds.
export type MembershipRead = Membership | { error: string }

export function asMembership(value: unknown): Membership {
  return value === 'join' || value === 'invite' || value === 'knock' || value === 'leave' || value === 'ban'
    ? value
    : 'none'
}

export interface RoomLevels {
  isSpace: boolean
  myLevel: number
  targetLevel: number
  requiredToSet: number
  // They created this room in a version where creators hold unlimited power
  // (room version 12 onward). Nobody can set their level.
  targetIsCreator: boolean
}

export type Verdict =
  | { kind: 'reading' }
  | { kind: 'same'; level: number }
  | { kind: 'blocked'; reason: string }
  // waits: they are not in the room, so the level waits for them to join.
  // ownLevel: it is YOUR level, and you cannot change it back afterwards.
  | { kind: 'change'; from: number; to: number; waits: boolean; ownLevel: boolean }

export function judgeRoom(levels: RoomLevels, membership: MembershipRead | null, to: number, isSelf: boolean): Verdict {
  const where = levels.isSpace ? 'space' : 'room'
  if (isSelf) {
    return {
      kind: 'blocked',
      reason: `Your own level is not set from here. Step down one ${where} at a time, from its row under Rooms: nobody below you can put you back.`,
    }
  }
  if (levels.targetIsCreator) return { kind: 'blocked', reason: creatorRefusal(false, levels.isSpace) }
  // Already there needs no write, whatever their membership turns out to be.
  if (levels.targetLevel === to) return { kind: 'same', level: to }
  if (membership === null) return { kind: 'reading' }
  if (typeof membership === 'object') {
    return { kind: 'blocked', reason: `Their membership here could not be read (${membership.error}). Use Read again to retry.` }
  }
  if (membership === 'ban') {
    return { kind: 'blocked', reason: `They are banned from this ${where}. Unban them first if they belong here.` }
  }
  const r = refusal({ isSelf: false, ...levels }, to)
  if (r) return { kind: 'blocked', reason: r }
  return {
    kind: 'change',
    from: levels.targetLevel,
    to,
    waits: membership !== 'join' && membership !== 'invite',
    ownLevel: to === levels.myLevel,
  }
}

// The preview's facts for one room, from what the client has synced.
export function levelsFromFacts(room: RoomFacts, me: string, target: string): RoomLevels {
  const at = (userId: string) =>
    room.creators.includes(userId)
      ? Infinity
      : (room.users.find((u) => u.userId === userId)?.level ?? room.usersDefault)
  return {
    isSpace: room.isSpace,
    myLevel: at(me),
    targetLevel: at(target),
    requiredToSet: room.powerLevelsRequired,
    targetIsCreator: room.creators.includes(target),
  }
}

// The write's facts for one room, from content just read off the server.
export function levelsFromContent(
  content: Record<string, unknown>,
  room: { isSpace: boolean; creators: readonly string[] },
  me: string,
  target: string,
): RoomLevels {
  return {
    isSpace: room.isSpace,
    myLevel: levelIn(content, me, room.creators),
    targetLevel: levelIn(content, target, room.creators),
    requiredToSet: requiredToSetPower(content),
    targetIsCreator: room.creators.includes(target),
  }
}

// ---------------------------------------------------------------------------
// The run.
// ---------------------------------------------------------------------------

export interface BulkIO {
  // The room's power-levels content as the server holds it now, or null when
  // the room has no power-levels event at all.
  readLevels(roomId: string): Promise<Record<string, unknown> | null>
  readMembership(roomId: string, userId: string): Promise<Membership>
  writeLevels(roomId: string, content: Record<string, unknown>): Promise<void>
  // Resolves after `ms`, or as soon as `stopped()` turns true: a Stop pressed
  // during a minute-long rate-limit pause takes effect now, not in a minute.
  sleep(ms: number, stopped: () => boolean): Promise<void>
}

export interface BulkRoom {
  roomId: string
  isSpace: boolean
  creators: readonly string[]
}

export interface BulkJob {
  me: string
  target: string
  to: number
  rooms: readonly BulkRoom[]
}

export type Progress =
  | { kind: 'queued' }
  | { kind: 'working' }
  // Rate-limited; retrying after this long.
  | { kind: 'waiting'; ms: number }
  | { kind: 'done'; from: number; to: number; waits: boolean }
  // Nothing was written, and this says why -- including "it had changed".
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; reason: string }

// A rate limit is waited out, not reported as a failure: the server said
// "later", not "no". Bounded, so a server that never relents ends the room as
// failed rather than holding the run forever.
export const RATE_LIMIT_TRIES = 5
export const RATE_LIMIT_DEFAULT_MS = 3000
export const RATE_LIMIT_MAX_MS = 60_000

export class Stopped extends Error {}

// The wait a rate-limited attempt gets: what the server asked for, a default
// when it named none (0 or absent), never more than the cap.
export function rateLimitPause(asked: number): number {
  return Math.min(RATE_LIMIT_MAX_MS, asked > 0 ? asked : RATE_LIMIT_DEFAULT_MS)
}

// Run `attempt` until it succeeds, waiting out rate limits between tries. Any
// other failure is thrown at once. The WHOLE attempt is repeated, never a
// piece of it: a write retried after a pause must be built from a read taken
// after that pause, or whatever changed during it is deleted by the write.
export async function patiently<T>(
  attempt: () => Promise<T>,
  sleep: BulkIO['sleep'],
  stopped: () => boolean,
  onWait: (ms: number) => void,
  onResume: () => void,
): Promise<T> {
  for (let tries = 1; ; tries++) {
    try {
      return await attempt()
    } catch (err) {
      const asked = rateLimitWaitMs(err)
      if (asked === null || tries >= RATE_LIMIT_TRIES) throw err
      const ms = rateLimitPause(asked)
      onWait(ms)
      await sleep(ms, stopped)
      if (stopped()) throw new Stopped()
      onResume()
    }
  }
}

export async function runBulk(
  job: BulkJob,
  io: BulkIO,
  report: (roomId: string, p: Progress) => void,
  stopped: () => boolean,
): Promise<Map<string, Progress>> {
  const out = new Map<string, Progress>()
  const set = (roomId: string, p: Progress) => {
    out.set(roomId, p)
    report(roomId, p)
  }
  for (const room of job.rooms) set(room.roomId, { kind: 'queued' })

  for (const room of job.rooms) {
    const where = room.isSpace ? 'space' : 'room'
    if (stopped()) {
      set(room.roomId, { kind: 'skipped', reason: 'Stopped before this one.' })
      continue
    }
    set(room.roomId, { kind: 'working' })

    // Read, judge, write -- as one attempt, so a rate-limited write starts
    // again from the read. Any other failure is the room's failure; the run
    // goes on to the next room (doctrine rule 6), and the room's row says what
    // happened.
    const attempt = async (): Promise<Progress> => {
      const content = await io.readLevels(room.roomId)
      if (content === null) {
        return {
          kind: 'skipped',
          reason: `This ${where} has no power-levels event, so there is no list to add them to. Writing one from here would take its creator's power away.`,
        }
      }
      const membership = await io.readMembership(room.roomId, job.target)
      const v = judgeRoom(levelsFromContent(content, room, job.me, job.target), membership, job.to, job.me === job.target)
      if (v.kind === 'same') return { kind: 'skipped', reason: `Already at ${v.level} when it came to write.` }
      // 'reading' cannot come back from a membership that was just read;
      // blocked says its own reason, which may differ from the preview's.
      if (v.kind !== 'change') return { kind: 'skipped', reason: v.kind === 'blocked' ? v.reason : 'Their membership could not be read.' }
      await io.writeLevels(room.roomId, withUserLevel(content, job.target, job.to))
      return { kind: 'done', from: v.from, to: v.to, waits: v.waits }
    }

    try {
      set(room.roomId, await patiently(
        attempt,
        io.sleep,
        stopped,
        (ms) => set(room.roomId, { kind: 'waiting', ms }),
        () => set(room.roomId, { kind: 'working' }),
      ))
    } catch (err) {
      if (err instanceof Stopped) {
        set(room.roomId, { kind: 'skipped', reason: 'Stopped while waiting on the server; nothing was written here.' })
        continue
      }
      set(room.roomId, { kind: 'failed', reason: describePowerError(err, room.isSpace) })
    }
  }
  return out
}

export interface Tally {
  done: number
  skipped: number
  failed: number
  pending: number
}

export function tally(progress: ReadonlyMap<string, Progress>): Tally {
  const t: Tally = { done: 0, skipped: 0, failed: 0, pending: 0 }
  for (const p of progress.values()) {
    if (p.kind === 'done') t.done++
    else if (p.kind === 'skipped') t.skipped++
    else if (p.kind === 'failed') t.failed++
    else t.pending++
  }
  return t
}

// ---------------------------------------------------------------------------
// Choosing rooms. A room is choosable when the preview says the change would
// happen there; the quick picks take every choosable room of one kind, and
// never a room the preview could not judge.
// ---------------------------------------------------------------------------
export function choosable(v: Verdict): boolean {
  return v.kind === 'change'
}

// The "or [level]" box. Empty means the pressed tier stands; anything else
// must be a whole number from 0 to 100 or it is NO level -- never the last
// keystroke that happened to parse (typing 150 passes through 1 and 15).
export function customLevel(text: string): { kind: 'empty' } | { kind: 'level'; level: number } | { kind: 'invalid' } {
  const s = text.trim()
  if (s === '') return { kind: 'empty' }
  if (!/^\d{1,3}$/.test(s)) return { kind: 'invalid' }
  const n = Number(s)
  return n <= 100 ? { kind: 'level', level: n } : { kind: 'invalid' }
}

export function pickKind(
  rows: readonly { roomId: string; isSpace: boolean }[],
  verdicts: ReadonlyMap<string, Verdict>,
  kind: 'rooms' | 'spaces',
): Set<string> {
  const out = new Set<string>()
  for (const r of rows) {
    if (r.isSpace !== (kind === 'spaces')) continue
    const v = verdicts.get(r.roomId)
    if (v && choosable(v)) out.add(r.roomId)
  }
  return out
}
