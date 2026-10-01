// Checks for setting one person's level in many rooms (launch-polish L19),
// and for the one write path every level change now takes (powerWrite.ts).
//
// The failure this is built against is not a wrong answer on screen; it is a
// write that succeeds and deletes something. A power-levels event is replaced
// whole, so a write built from a stale copy wipes whatever changed since --
// the grant a bot needs for a custom event, somebody else's promotion -- and
// nothing reports it. So the heart of this file is a fake server whose state
// moves between the preview and the write, and the question is what survives.
import {
  asMembership,
  choosable,
  customLevel,
  judgeRoom,
  levelsFromContent,
  levelsFromFacts,
  pickKind,
  runBulk,
  tally,
  RATE_LIMIT_DEFAULT_MS,
  RATE_LIMIT_MAX_MS,
  RATE_LIMIT_TRIES,
  type BulkIO,
  type Membership,
  type Progress,
  type RoomLevels,
} from '../src/client/bulkPower.ts'
import { PowerRefused, powerIO, setUserLevel } from '../src/client/powerWrite.ts'
import { bulkRunFor, bulkRunning, dismissBulkRun, startBulkRun, stopBulkRun, subscribeBulkRun } from '../src/client/bulkRun.ts'
import { readFileSync } from 'node:fs'
import type { RoomFacts } from '../src/client/serverPermissions.ts'

let failures = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const ME = '@saber:x.net'
const MOD = '@kestrel:x.net'

const levels = (over: Partial<RoomLevels> = {}): RoomLevels => ({
  isSpace: false,
  myLevel: 100,
  targetLevel: 0,
  requiredToSet: 50,
  targetIsCreator: false,
  ...over,
})

console.log('\n-- one room, judged --')
{
  const v = judgeRoom(levels(), 'join', 50, false)
  check('a member at 0, set to 50 by an owner: a change', v.kind === 'change' && v.from === 0 && v.to === 50, v)
  check('and a joined member does not wait', v.kind === 'change' && !v.waits)
  check('the same level is not a change', judgeRoom(levels({ targetLevel: 50 }), 'join', 50, false).kind === 'same')
  check('already-there needs no membership read', judgeRoom(levels({ targetLevel: 50 }), null, 50, false).kind === 'same')
  check('otherwise an unread membership is still reading', judgeRoom(levels(), null, 50, false).kind === 'reading')
}

console.log('\n-- rooms they are not in --')
{
  // Matrix keeps a level for anyone the event names and applies it when they
  // join. For making somebody a moderator everywhere, that is the point.
  for (const m of ['leave', 'none', 'knock'] as Membership[]) {
    const v = judgeRoom(levels(), m, 50, false)
    check(`${m}: offered, and says it waits for them`, v.kind === 'change' && v.waits, v)
  }
  const inv = judgeRoom(levels(), 'invite', 50, false)
  check('an invitee does not "wait": the invite is already theirs', inv.kind === 'change' && !inv.waits)
  const ban = judgeRoom(levels(), 'ban', 50, false)
  check('a banned user is refused, with the remedy', ban.kind === 'blocked' && /unban/i.test(ban.reason), ban)
  const err = judgeRoom(levels(), { error: 'HTTP 500' }, 50, false)
  check('an unreadable membership is refused and says so', err.kind === 'blocked' && err.reason.includes('HTTP 500'))
}

console.log('\n-- the homeserver\'s rules, the same as the one-room editor\'s --')
{
  const weak = judgeRoom(levels({ myLevel: 25, requiredToSet: 50 }), 'join', 25, false)
  check('below the requirement to change levels: refused, both numbers named',
    weak.kind === 'blocked' && weak.reason.includes('50') && weak.reason.includes('25'), weak)
  const above = judgeRoom(levels({ myLevel: 50 }), 'join', 100, false)
  check('above your own level: refused', above.kind === 'blocked' && above.reason.includes('100'), above)
  const peer = judgeRoom(levels({ myLevel: 50, targetLevel: 50 }), 'join', 25, false)
  check('somebody at your own level: refused', peer.kind === 'blocked', peer)
  const own = judgeRoom(levels({ myLevel: 50 }), 'join', 50, false)
  check('your own level is allowed and flagged as one you cannot take back',
    own.kind === 'change' && own.ownLevel, own)
  check('a fraction is refused -- the server has no floats',
    judgeRoom(levels(), 'join', 49.5, false).kind === 'blocked')
  const self = judgeRoom(levels(), 'join', 0, true)
  check('your own level is never set in bulk', self.kind === 'blocked' && /one (room|space) at a time/.test(self.reason), self)
}

console.log('\n-- room version 12 creators --')
{
  const facts = (over: Partial<RoomFacts>): RoomFacts => ({
    roomId: '!r:x.net', name: 'r', isSpace: false, isDm: false, parentIds: [], joinRule: 'invite',
    historyVisibility: 'shared', guestAccess: 'forbidden', encrypted: false, memberCount: 3,
    usersDefault: 0, eventsDefault: 0, stateDefault: 50, invite: 0, kick: 50, ban: 50, redact: 50,
    powerLevelsRequired: 50, users: [], creators: [], ...over,
  })
  const mine = levelsFromFacts(facts({ creators: [ME] }), ME, MOD)
  check('a creator is unlimited, not 0 for want of a users entry', mine.myLevel === Infinity)
  const v = judgeRoom(mine, 'join', 100, false)
  check('so a creator can make an owner', v.kind === 'change' && !v.ownLevel, v)
  const theirs = judgeRoom(levelsFromFacts(facts({ creators: [MOD] }), ME, MOD), 'join', 0, false)
  check('and nobody can set a creator', theirs.kind === 'blocked' && /created/.test(theirs.reason), theirs)
  const fromContent = levelsFromContent({ users: { [MOD]: 50 }, users_default: 0 }, { isSpace: false, creators: [ME] }, ME, MOD)
  check('the same from raw content', fromContent.myLevel === Infinity && fromContent.targetLevel === 50)
}

console.log('\n-- quick picks take only what can change, of one kind --')
{
  const rows = [
    { roomId: '!a', isSpace: false }, { roomId: '!b', isSpace: false },
    { roomId: '!s', isSpace: true }, { roomId: '!c', isSpace: false },
  ]
  const verdicts = new Map([
    ['!a', judgeRoom(levels(), 'join', 50, false)],
    ['!b', judgeRoom(levels({ targetLevel: 50 }), 'join', 50, false)],
    ['!s', judgeRoom(levels({ isSpace: true }), 'join', 50, false)],
    ['!c', judgeRoom(levels(), null, 50, false)],
    // Refused by the preview: above my level, banned, a creator. None of these
    // may be ticked or picked; the write would only skip them.
    ['!x', judgeRoom(levels({ myLevel: 50, targetLevel: 50 }), 'join', 25, false)],
    ['!y', judgeRoom(levels(), 'ban', 50, false)],
    ['!z', judgeRoom(levels({ targetIsCreator: true, targetLevel: Infinity }), 'join', 50, false)],
  ])
  rows.push({ roomId: '!x', isSpace: false }, { roomId: '!y', isSpace: false }, { roomId: '!z', isSpace: false })
  check('the refused fixtures really are blocked', ['!x', '!y', '!z'].every((id) => verdicts.get(id)?.kind === 'blocked'))
  check('every room: the changeable room only', [...pickKind(rows, verdicts, 'rooms')].join(',') === '!a')
  check('every space: the space only', [...pickKind(rows, verdicts, 'spaces')].join(',') === '!s')
  check('a blocked room cannot be ticked', ['!x', '!y', '!z'].every((id) => !choosable(verdicts.get(id)!)))
  check('nor can a same or still-reading room', !choosable(verdicts.get('!b')!) && !choosable(verdicts.get('!c')!))
}

console.log('\n-- the "or [level]" box: a level, or plainly not one --')
{
  const k = (s: string) => { const c = customLevel(s); return c.kind === 'level' ? c.level : c.kind }
  check('empty leaves the pressed tier standing', k('') === 'empty' && k('  ') === 'empty')
  check('whole numbers 0 to 100 are levels', k('0') === 0 && k('15') === 15 && k(' 75 ') === 75 && k('100') === 100)
  // Typing 150 passes through 1 and 15 on the way. The box ends at 150, which
  // is no level -- never the 15 the last parse happened to leave behind.
  check('150 is not a level (and not the 15 typed on the way to it)', k('150') === 'invalid')
  check('fractions, signs and exponents are not levels', ['7.5', '-1', '1e2', '+5', '0x10', 'abc'].every((s) => k(s) === 'invalid'))
}

console.log('\n-- membership values from the server --')
{
  check('the five real ones pass through', (['join', 'invite', 'knock', 'leave', 'ban'] as const).every((m) => asMembership(m) === m))
  check('anything else is none', asMembership('weird') === 'none' && asMembership(undefined) === 'none')
}

// ---------------------------------------------------------------------------
// The run, against a fake server.
// ---------------------------------------------------------------------------
interface FakeRoom {
  levels: Record<string, unknown> | null
  members: Record<string, Membership>
  failWrite?: unknown
  // 429s still to come on writes, on power-level reads, on membership reads.
  rateLimits?: number
  readRateLimits?: number
  memberRateLimits?: number
  // What a 429 asks for; absent means the 1234 most cases use.
  retryAfter?: number | null
}

function fakeServer(rooms: Record<string, FakeRoom>, onSleep: (ms: number) => void = () => {}) {
  const writes: { roomId: string; content: Record<string, unknown> }[] = []
  const slept: number[] = []
  const limited = (r: FakeRoom) => ({
    errcode: 'M_LIMIT_EXCEEDED',
    httpStatus: 429,
    data: r.retryAfter === null ? {} : { retry_after_ms: r.retryAfter ?? 1234 },
  })
  const io: BulkIO = {
    async readLevels(roomId) {
      const r = rooms[roomId]
      if (r.readRateLimits && r.readRateLimits > 0) { r.readRateLimits--; throw limited(r) }
      return r.levels === null ? null : structuredClone(r.levels)
    },
    async readMembership(roomId, userId) {
      const r = rooms[roomId]
      if (r.memberRateLimits && r.memberRateLimits > 0) { r.memberRateLimits--; throw limited(r) }
      return r.members[userId] ?? 'none'
    },
    async writeLevels(roomId, content) {
      const r = rooms[roomId]
      if (r.rateLimits && r.rateLimits > 0) {
        r.rateLimits--
        throw limited(r)
      }
      if (r.failWrite) throw r.failWrite
      writes.push({ roomId, content })
      r.levels = structuredClone(content)
    },
    async sleep(ms) { slept.push(ms); onSleep(ms) },
  }
  return { io, writes, slept }
}

const base = () => ({
  users: { [ME]: 100, '@nobu:x.net': 25 },
  users_default: 0,
  events: { 'm.room.power_levels': 100, 'net.41chan.media.tags': 10 },
  state_default: 50,
})

console.log('\n-- the write is built from what the server holds NOW --')
{
  // The preview saw the room before a bot's grant and before nobu's
  // promotion. Both happened on the server; the write must carry both.
  const server = fakeServer({ '!g': { levels: { ...base(), users: { [ME]: 100, '@nobu:x.net': 50, '@tunnel:x.net': 10 } }, members: { [MOD]: 'join' } } })
  const out = await runBulk({ me: ME, target: MOD, to: 50, rooms: [{ roomId: '!g', isSpace: false, creators: [] }] }, server.io, () => {}, () => false)
  const w = server.writes[0]?.content as { users: Record<string, number>; events: Record<string, number> } | undefined
  check('it wrote', out.get('!g')?.kind === 'done', out.get('!g'))
  check('the target got the level', w?.users[MOD] === 50)
  check("somebody else's promotion since the preview survived", w?.users['@nobu:x.net'] === 50)
  check('a user added since the preview survived', w?.users['@tunnel:x.net'] === 10)
  check('a custom event\'s requirement survived (the key a stale write deletes)', w?.events['net.41chan.media.tags'] === 10)
  check('every other top-level key survived', w !== undefined && JSON.stringify(Object.keys(w).sort()) === JSON.stringify(Object.keys(base()).sort()))
}

console.log('\n-- the fresh read is judged again, and says so when the answer moved --')
{
  const server = fakeServer({
    '!same': { levels: { ...base(), users: { [ME]: 100, [MOD]: 50 } }, members: { [MOD]: 'join' } },
    '!raised': { levels: { ...base(), users: { [ME]: 75, [MOD]: 75 }, events: { 'm.room.power_levels': 50 } }, members: { [MOD]: 'join' } },
    '!banned': { levels: base(), members: { [MOD]: 'ban' } },
    '!none': { levels: null, members: {} },
  })
  const rooms = ['!same', '!raised', '!banned', '!none'].map((roomId) => ({ roomId, isSpace: false, creators: [] }))
  const out = await runBulk({ me: ME, target: MOD, to: 50, rooms }, server.io, () => {}, () => false)
  check('already there on the server: skipped, not written', out.get('!same')?.kind === 'skipped' && !server.writes.some((w) => w.roomId === '!same'))
  const r = out.get('!raised')
  check('they reached your level in the meantime: skipped with the reason', r?.kind === 'skipped' && /you are at 75/.test(r.reason), r)
  check('banned on the server: skipped', out.get('!banned')?.kind === 'skipped')
  const n = out.get('!none')
  check('no power-levels event: skipped for THAT reason, never written from nothing',
    n?.kind === 'skipped' && /no power-levels event/.test(n.reason) && !server.writes.some((w) => w.roomId === '!none'), n)
  check('nothing at all was written', server.writes.length === 0, server.writes)
}

console.log('\n-- one bad room never stops the rest (doctrine rule 6) --')
{
  const server = fakeServer({
    '!a': { levels: base(), members: { [MOD]: 'join' } },
    '!b': { levels: base(), members: { [MOD]: 'join' }, failWrite: { errcode: 'M_FORBIDDEN', httpStatus: 403, data: { error: 'nope' } } },
    '!c': { levels: base(), members: { [MOD]: 'join' } },
  })
  const seen: string[] = []
  const rooms = ['!a', '!b', '!c'].map((roomId) => ({ roomId, isSpace: false, creators: [] }))
  const out = await runBulk({ me: ME, target: MOD, to: 50, rooms }, server.io, (id, p) => seen.push(`${id}:${p.kind}`), () => false)
  check('the refused room failed, in terms of power, with the server\'s words',
    out.get('!b')?.kind === 'failed' && /refused/.test((out.get('!b') as { reason: string }).reason) && /nope/.test((out.get('!b') as { reason: string }).reason), out.get('!b'))
  check('and never mentions invites', !/invite/i.test((out.get('!b') as { reason: string }).reason))
  check('the rooms either side of it were written', out.get('!a')?.kind === 'done' && out.get('!c')?.kind === 'done')
  check('rooms are done in the order given', server.writes.map((w) => w.roomId).join(',') === '!a,!c')
  check('every room is reported queued before any is worked', seen.slice(0, 3).every((x) => x.endsWith(':queued')), seen)
  const t = tally(out)
  check('the tally adds up', t.done === 2 && t.failed === 1 && t.skipped === 0 && t.pending === 0, t)
}

console.log('\n-- a rate limit is waited out, and not forever --')
{
  const server = fakeServer({ '!a': { levels: base(), members: { [MOD]: 'join' }, rateLimits: 2 } })
  const kinds: Progress['kind'][] = []
  const out = await runBulk({ me: ME, target: MOD, to: 50, rooms: [{ roomId: '!a', isSpace: false, creators: [] }] }, server.io, (_id, p) => kinds.push(p.kind), () => false)
  check('it got there after two pauses', out.get('!a')?.kind === 'done', out.get('!a'))
  check('it waited as long as the server asked', server.slept.join(',') === '1234,1234', server.slept)
  check('and said it was waiting while it did', kinds.filter((k) => k === 'waiting').length === 2, kinds)

  const stubborn = fakeServer({ '!a': { levels: base(), members: { [MOD]: 'join' }, rateLimits: 99 } })
  const out2 = await runBulk({ me: ME, target: MOD, to: 50, rooms: [{ roomId: '!a', isSpace: false, creators: [] }] }, stubborn.io, () => {}, () => false)
  check('a server that never relents ends the room as failed', out2.get('!a')?.kind === 'failed', out2.get('!a'))
  check(`after ${RATE_LIMIT_TRIES} tries`, stubborn.slept.length === RATE_LIMIT_TRIES - 1, stubborn.slept.length)

  // The reads are most of a many-room run's requests; a 429 on one is waited
  // out the same way, not turned into the room's failure.
  const reads = fakeServer({ '!a': { levels: base(), members: { [MOD]: 'join' }, readRateLimits: 1, memberRateLimits: 1 } })
  const out3 = await runBulk({ me: ME, target: MOD, to: 50, rooms: [{ roomId: '!a', isSpace: false, creators: [] }] }, reads.io, () => {}, () => false)
  check('a 429 on either read is waited out too', out3.get('!a')?.kind === 'done' && reads.slept.length === 2, { out: out3.get('!a'), slept: reads.slept })

  const silent = fakeServer({ '!a': { levels: base(), members: { [MOD]: 'join' }, rateLimits: 1, retryAfter: null } })
  await runBulk({ me: ME, target: MOD, to: 50, rooms: [{ roomId: '!a', isSpace: false, creators: [] }] }, silent.io, () => {}, () => false)
  check('a 429 that names no wait gets the default, not zero', silent.slept.join(',') === String(RATE_LIMIT_DEFAULT_MS), silent.slept)
  const greedy = fakeServer({ '!a': { levels: base(), members: { [MOD]: 'join' }, rateLimits: 1, retryAfter: 3_600_000 } })
  await runBulk({ me: ME, target: MOD, to: 50, rooms: [{ roomId: '!a', isSpace: false, creators: [] }] }, greedy.io, () => {}, () => false)
  check('a 429 asking for an hour is capped', greedy.slept.join(',') === String(RATE_LIMIT_MAX_MS), greedy.slept)
}

console.log('\n-- a retry after a pause starts again from a fresh read --')
{
  // L19's own rule, under a 429: the write gets "later", and during the pause
  // another admin promotes nobu. The retried write must carry that, which it
  // can only do if it reads again rather than resending the pre-pause copy.
  const rooms: Record<string, FakeRoom> = { '!a': { levels: base(), members: { [MOD]: 'join' }, rateLimits: 1 } }
  const server = fakeServer(rooms, () => {
    (rooms['!a'].levels!.users as Record<string, number>)['@nobu:x.net'] = 50
  })
  const out = await runBulk({ me: ME, target: MOD, to: 50, rooms: [{ roomId: '!a', isSpace: false, creators: [] }] }, server.io, () => {}, () => false)
  const w = server.writes.at(-1)?.content as { users: Record<string, number> } | undefined
  check('it wrote, once', out.get('!a')?.kind === 'done' && server.writes.length === 1, out.get('!a'))
  check('the promotion made during the pause survived the write', w?.users['@nobu:x.net'] === 50, w)

  // And it is JUDGED again: during the pause they were raised to my level.
  const rooms2: Record<string, FakeRoom> = { '!a': { levels: { ...base(), users: { [ME]: 75 }, events: { 'm.room.power_levels': 50 } }, members: { [MOD]: 'join' }, rateLimits: 1 } }
  const server2 = fakeServer(rooms2, () => {
    (rooms2['!a'].levels!.users as Record<string, number>)[MOD] = 75
  })
  const out2 = await runBulk({ me: ME, target: MOD, to: 50, rooms: [{ roomId: '!a', isSpace: false, creators: [] }] }, server2.io, () => {}, () => false)
  const r2 = out2.get('!a')
  check('a change of standing during the pause is caught, and nothing is written',
    r2?.kind === 'skipped' && /you are at 75/.test(r2.reason) && server2.writes.length === 0, r2)
}

console.log('\n-- stopping --')
{
  const server = fakeServer({
    '!a': { levels: base(), members: { [MOD]: 'join' } },
    '!b': { levels: base(), members: { [MOD]: 'join' } },
  })
  let stop = false
  const rooms = ['!a', '!b'].map((roomId) => ({ roomId, isSpace: false, creators: [] }))
  const out = await runBulk({ me: ME, target: MOD, to: 50, rooms }, server.io, (id, p) => { if (id === '!a' && p.kind === 'done') stop = true }, () => stop)
  check('the room in hand finishes', out.get('!a')?.kind === 'done')
  check('the rest are not written, and say they were stopped',
    out.get('!b')?.kind === 'skipped' && /Stopped/.test((out.get('!b') as { reason: string }).reason) && server.writes.length === 1)

  // Stop pressed DURING a rate-limit pause: the room in hand is abandoned
  // with nothing written, and says so.
  let stop2 = false
  const paused = fakeServer({ '!a': { levels: base(), members: { [MOD]: 'join' }, rateLimits: 1 } }, () => { stop2 = true })
  const out2 = await runBulk({ me: ME, target: MOD, to: 50, rooms: [{ roomId: '!a', isSpace: false, creators: [] }] }, paused.io, () => {}, () => stop2)
  const r = out2.get('!a')
  check('a stop during a pause writes nothing there, and says it was waiting',
    r?.kind === 'skipped' && /Stopped while waiting/.test(r.reason) && paused.writes.length === 0, r)
}

console.log('\n-- the tally while a run is still going --')
{
  const mid = new Map<string, Progress>([
    ['!a', { kind: 'done', from: 0, to: 50, waits: false }],
    ['!b', { kind: 'working' }],
    ['!c', { kind: 'waiting', ms: 1000 }],
    ['!d', { kind: 'queued' }],
    ['!e', { kind: 'skipped', reason: 'x' }],
    ['!f', { kind: 'failed', reason: 'y' }],
  ])
  const t = tally(mid)
  // BulkLevels' "Setting N of M" is finished+1; a queued room counted as
  // finished would read "Setting 6 of 6" the moment a run starts.
  check('rooms not yet finished are pending, not finished', t.pending === 3 && t.done === 1 && t.skipped === 1 && t.failed === 1, t)
}

// ---------------------------------------------------------------------------
// The client side: the SDK stand-in, and the one-room path.
// ---------------------------------------------------------------------------
console.log('\n-- powerIO speaks to the client the way the SDK expects --')
{
  const calls: string[] = []
  const state: Record<string, Record<string, unknown>> = { 'm.room.power_levels/': { users: { [ME]: 100 } }, [`m.room.member/${MOD}`]: { membership: 'leave' } }
  const fake = {
    async getStateEvent(_roomId: string, type: string, key: string) {
      const v = state[`${type}/${key}`]
      if (!v) throw { errcode: 'M_NOT_FOUND', httpStatus: 404 }
      return v
    },
    // Uses `this`, as the SDK's does (G-bf03): an unbound call throws.
    async sendStateEvent(this: { marker?: boolean }, roomId: string, type: string, content: Record<string, unknown>, key: string) {
      if (!this?.marker) throw new Error('called without its this')
      calls.push(`${roomId}|${type}|${key}|${JSON.stringify(content)}`)
      return { event_id: '$e' }
    },
    marker: true,
  }
  const io = powerIO(fake as never)
  check('a room without power levels reads as null', (await io.readLevels('!r').then(() => 'x', () => 'threw')) === 'x' && (await (async () => { delete state['m.room.power_levels/']; return io.readLevels('!r') })()) === null)
  check('someone never in the room reads as none', (await io.readMembership('!r', '@ghost:x.net')) === 'none')
  check('someone who left reads as leave', (await io.readMembership('!r', MOD)) === 'leave')
  await io.writeLevels('!r', { users: { [MOD]: 50 } })
  check('the write is a power_levels state event with an empty key, sent with its this',
    calls.length === 1 && calls[0].startsWith('!r|m.room.power_levels||'), calls)

  // A pause ends when Stop is pressed, not when the server's minute is up.
  const t0 = Date.now()
  await io.sleep(10_000, () => true)
  check('a stopped pause returns at once', Date.now() - t0 < 300, Date.now() - t0)
  const t1 = Date.now()
  let flips = 0
  await io.sleep(10_000, () => ++flips > 2)
  check('a pause stopped part-way returns within a beat of the stop', Date.now() - t1 < 1000, Date.now() - t1)
  const t2 = Date.now()
  await io.sleep(120, () => false)
  check('an unstopped pause lasts as long as asked', Date.now() - t2 >= 110, Date.now() - t2)
}

console.log('\n-- the one-room path reads fresh and refuses by the same rules --')
{
  const server = fakeServer({ '!g': { levels: { ...base(), users: { [ME]: 50, '@nobu:x.net': 25 }, events: { 'm.room.power_levels': 50, 'net.41chan.media.tags': 10 } }, members: {} } })
  const r = await setUserLevel(server.io, { roomId: '!g', isSpace: false, creators: [] }, ME, '@nobu:x.net', 0)
  check('it writes from the server\'s copy and reports what changed', r.from === 25 && r.to === 0 && server.writes.length === 1)
  check('keeping everything else', (server.writes[0].content.events as Record<string, number>)['net.41chan.media.tags'] === 10)
  const above = await setUserLevel(server.io, { roomId: '!g', isSpace: false, creators: [] }, ME, '@nobu:x.net', 100).then(() => null, (e) => e)
  check('above your own level is refused before anything is sent', above instanceof PowerRefused && server.writes.length === 1, above)
  const self = await setUserLevel(server.io, { roomId: '!g', isSpace: false, creators: [] }, ME, ME, 25)
  check('here you may still step yourself down', self.from === 50 && self.to === 25)
  const creator = await setUserLevel(server.io, { roomId: '!g', isSpace: false, creators: [MOD] }, ME, MOD, 0).then(() => null, (e) => e)
  check('a creator cannot be set', creator instanceof PowerRefused && /They created/.test(creator.message), creator)
  // The case only the explicit guard catches: the creator is YOU. The standing
  // rule lets anyone lower themselves, so without the guard this would write
  // users[creator] -- an event the homeserver rejects for listing a creator.
  const writesBefore = server.writes.length
  const myself = await setUserLevel(server.io, { roomId: '!g', isSpace: false, creators: [ME] }, ME, ME, 25).then(() => null, (e) => e)
  check('a creator cannot step themselves down, and is told it is them',
    myself instanceof PowerRefused && /You created/.test(myself.message) && server.writes.length === writesBefore, myself)
  const bare = fakeServer({ '!n': { levels: null, members: {} } })
  const none = await setUserLevel(bare.io, { roomId: '!n', isSpace: false, creators: [] }, ME, MOD, 50).then(() => null, (e) => e)
  check('a room with no power levels is refused, not written from nothing (the SDK path wrote one naming only the target)',
    none instanceof PowerRefused && bare.writes.length === 0)
}

// ---------------------------------------------------------------------------
// The run outlives the panel that started it.
// ---------------------------------------------------------------------------
console.log('\n-- a confirmed run belongs to the session, not to the panel --')
{
  // The panel used to stop the run on unmount and lose its report, so the
  // Rooms pill or another Settings tab halted a confirmed run silently.
  const src = readFileSync('src/ui/BulkLevels.tsx', 'utf8')
  check('the panel no longer stops a run when it goes away', !/useEffect\(\(\) => \(\) => \{ stop/.test(src) && !/stop\.current = true/.test(src))
  let gate!: () => void
  const held = new Promise<void>((r) => { gate = r })
  const server = fakeServer({ '!a': { levels: base(), members: { [MOD]: 'join' } }, '!b': { levels: base(), members: { [MOD]: 'join' } }, '!c': { levels: base(), members: { [MOD]: 'join' } } })
  const slow: BulkIO = { ...server.io, async readLevels(id) { if (id === '!b') await held; return server.io.readLevels(id) } }
  let pings = 0
  const off = subscribeBulkRun(() => { pings++ })
  const running = startBulkRun({ me: ME, target: MOD, to: 50, rooms: ['!a', '!b', '!c'].map((roomId) => ({ roomId, isSpace: false, creators: [] })) }, slow)
  await new Promise((r) => setTimeout(r, 0))
  const mid = bulkRunFor(ME)
  check('while it runs, the run is there for its account', mid?.phase === 'run' && bulkRunning() && mid.target === MOD && mid.to === 50, mid)
  check('and for nobody else', bulkRunFor('@else:x.net') === null)
  check('a snapshot is stable between changes', bulkRunFor(ME) === bulkRunFor(ME))
  check('rooms written so far are counted for the Rooms view to re-read on', mid?.written === 1, mid?.written)
  dismissBulkRun()
  check('a run in progress cannot be dismissed out from under itself', bulkRunFor(ME)?.phase === 'run')
  const beforeStop = bulkRunFor(ME)
  const pingsBeforeStop = pings
  stopBulkRun()
  // A NEW snapshot, announced: the panel reads this through
  // useSyncExternalStore, which re-renders only when the object changes.
  check('Stop is acknowledged at once, as a new snapshot subscribers hear about',
    bulkRunFor(ME)?.stopping === true && bulkRunFor(ME) !== beforeStop && pings > pingsBeforeStop)
  const second = await startBulkRun({ me: ME, target: MOD, to: 25, rooms: [] }, slow).then(() => 'started', () => 'refused')
  check('a second run cannot start over the first', second === 'refused')
  gate()
  await running
  const end = bulkRunFor(ME)
  check('the finished run and its report stay until dismissed',
    end?.phase === 'done' && end.progress.get('!a')?.kind === 'done' && end.progress.get('!b')?.kind === 'done'
      && end.progress.get('!c')?.kind === 'skipped', end && [...end.progress])
  check('subscribers heard every change', pings >= 4, pings)
  dismissBulkRun()
  check('Start again dismisses a finished run', bulkRunFor(ME) === null)
  off()
}

console.log('\n-- an unreadable membership names a control that exists --')
{
  const v = judgeRoom(levels(), { error: 'HTTP 502' }, 50, false)
  check('the row says what failed and to use Read again', v.kind === 'blocked' && /HTTP 502/.test(v.reason) && /Read again/.test(v.reason), v)
  const src = readFileSync('src/ui/BulkLevels.tsx', 'utf8')
  check('and the bulk view has a Read again button', /<button[^>]*>[\s\S]{0,200}?Read again/.test(src))
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
