// Checks for the Server Permissions audit (ui-depth-v1 U8).
//
// The audit reports two kinds of thing and the difference between them is the
// whole design, so most of these cases are about keeping them apart: a HARD
// finding is true of any Matrix room regardless of taste, an OUTLIER is this
// room disagreeing with the rest of this server and is never called a fault.
//
// The other half is rule 8 of the doctrine: an outlier list computed from too
// few rooms must not be indistinguishable from an outlier list that ran and
// found nothing. Empty-because-unmeasured and empty-because-clean are
// different answers.
import {
  MIN_FOR_CONSENSUS,
  auditRooms,
  compareRooms,
  compareUsers,
  findingsFor,
  normaliseRange,
  structure,
  usersInRange,
  type RoomFacts,
} from '../src/client/serverPermissions.ts'

let failures = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

// A well-formed, unremarkable room. Every case below is this with one thing
// changed, so a finding can only come from the thing that was changed.
function room(over: Partial<RoomFacts> = {}): RoomFacts {
  return {
    roomId: '!r:x.net',
    name: 'general',
    isSpace: false,
    isDm: false,
    parentIds: [],
    joinRule: 'invite',
    historyVisibility: 'shared',
    guestAccess: 'forbidden',
    encrypted: false,
    memberCount: 12,
    usersDefault: 0,
    eventsDefault: 0,
    stateDefault: 50,
    invite: 50,
    kick: 50,
    ban: 50,
    redact: 50,
    powerLevelsRequired: 50,
    users: [{ userId: '@saber:x.net', level: 100 }],
    ...over,
  }
}
const hard = (r: RoomFacts) => auditRooms([r]).findings.filter((f) => f.kind === 'hard')
const fields = (r: RoomFacts) => hard(r).map((f) => f.field).sort().join(',')

console.log('\n-- a well-formed room reports nothing --')
{
  check('no hard findings', hard(room()).length === 0, hard(room()))
  // One room is nowhere near a consensus, so the outlier pass must not run.
  const a = auditRooms([room()])
  check('and says the consensus pass did not run', a.consensusSkipped)
  check('one room audited', a.auditedRooms === 1)
}

console.log('\n-- the faults that are faults anywhere --')
{
  check('a room with nobody at 100 cannot be administered',
    fields(room({ users: [{ userId: '@a:x.net', level: 50 }] })) === 'no-admin')
  check('and the message names the highest level anyone actually holds',
    hard(room({ users: [{ userId: '@a:x.net', level: 50 }] }))[0].why.includes('50'))
  check('an empty room is the same fault',
    fields(room({ users: [] })) === 'no-admin')

  check('a users_default above zero is a finding',
    fields(room({ usersDefault: 10 })).includes('users_default'))
  check('and the number is in the message',
    hard(room({ usersDefault: 10 })).some((f) => f.what.includes('10')))

  check('power levels sendable below 50 is a finding',
    fields(room({ powerLevelsRequired: 25 })).includes('power_levels'))
  check('guests able to join is a finding',
    fields(room({ guestAccess: 'can_join' })).includes('guest_access'))

  // The window left open on a shut door.
  check('world-readable history on a non-public room is a finding',
    fields(room({ historyVisibility: 'world_readable' })).includes('history_visibility'))
  check('world-readable history on a PUBLIC room is not',
    !fields(room({ historyVisibility: 'world_readable', joinRule: 'public' })).includes('history_visibility'))
}

console.log('\n-- the same fault arriving by a different road --')
{
  // Requirement 0 with default 0: nobody is below the bar, so everybody can
  // rewrite the power levels. A check on the requirement alone misses it when
  // the requirement is 50 and the default is also 50.
  const both = fields(room({ usersDefault: 50, powerLevelsRequired: 50 }))
  check('a default that already meets the requirement is caught',
    both.includes('power_levels'), both)
}

console.log('\n-- DMs are not audited --')
{
  // Both sides of a DM are at 100 and its history is shared. That is not a
  // broken power structure, it is a DM, and auditing them would bury every
  // real finding under one per conversation.
  const a = auditRooms([room({ isDm: true, users: [], usersDefault: 100 })])
  check('a DM produces no findings', a.findings.length === 0, a.findings)
  check('and is counted as skipped, so the total is explicable', a.skippedDms === 1)
  check('and does not count as audited', a.auditedRooms === 0)
}

console.log('\n-- outliers need a consensus to be outliers from --')
{
  const many = (n: number, over: (i: number) => Partial<RoomFacts> = () => ({})) =>
    Array.from({ length: n }, (_, i) => room({ roomId: `!r${i}:x.net`, name: `room-${i}`, ...over(i) }))

  // Below the floor with something that WOULD be reported above it. A set of
  // identical rooms proves nothing here: it has no outliers either way, which
  // is how the first version of this case passed with the floor deleted.
  const few = auditRooms(many(MIN_FOR_CONSENSUS - 1, (i) => (i === 0 ? { joinRule: 'public' } : {})))
  check('below the floor, the pass is skipped', few.consensusSkipped)
  check('and reports no outliers rather than a clean bill',
    few.findings.filter((f) => f.kind === 'outlier').length === 0,
    few.findings.filter((f) => f.kind === 'outlier'))

  const enough = auditRooms(many(MIN_FOR_CONSENSUS + 2))
  check('at the floor, the pass runs', !enough.consensusSkipped)
  check('and an agreeing set has no outliers',
    enough.findings.filter((f) => f.kind === 'outlier').length === 0)

  // One room differs: it is reported, as an outlier and not as a fault.
  const odd = many(6, (i) => (i === 0 ? { joinRule: 'public' } : {}))
  const withOdd = auditRooms(odd)
  const outliers = withOdd.findings.filter((f) => f.kind === 'outlier')
  check('the room that differs is reported', outliers.some((f) => f.roomId === '!r0:x.net'))
  check('and only that room is', outliers.every((f) => f.roomId === '!r0:x.net'), outliers)
  check('it is an outlier, never a fault',
    withOdd.findings.filter((f) => f.kind === 'hard').length === 0)
  check('and the message says what the rest of the server does',
    outliers[0].why.includes('5'))
}

console.log('\n-- a plurality is not a consensus --')
{
  const withRules = (rules: string[]) =>
    auditRooms(rules.map((jr, i) => room({ roomId: `!r${i}:x.net`, name: `room-${i}`, joinRule: jr })))
      .findings.filter((f) => f.field === 'join_rule')

  // An even split: calling either side outliers would be picking a winner by
  // iteration order.
  check('an even split reports nobody',
    withRules(['public', 'public', 'public', 'invite', 'invite', 'invite']).length === 0)

  // The case the even split does not cover: a clear plurality that is still
  // not a majority. Three of seven is the most popular answer and is not what
  // the server does.
  check('a plurality short of half reports nobody',
    withRules(['public', 'public', 'public', 'invite', 'invite', 'knock', 'restricted']).length === 0,
    withRules(['public', 'public', 'public', 'invite', 'invite', 'knock', 'restricted']))

  // One more of the same, and it IS a majority: the other three are outliers.
  check('one past half, and the rest are outliers',
    withRules(['public', 'public', 'public', 'public', 'invite', 'invite', 'knock']).length === 3,
    withRules(['public', 'public', 'public', 'public', 'invite', 'invite', 'knock']))
}

console.log('\n-- spaces are compared with spaces --')
{
  // Five rooms that are all public and one space that is invite-only. The
  // space must not be an outlier against a consensus of chat rooms.
  const mixed = [
    ...Array.from({ length: 5 }, (_, i) => room({ roomId: `!r${i}:x.net`, name: `r${i}`, joinRule: 'public' })),
    room({ roomId: '!s:x.net', name: 'space', isSpace: true, joinRule: 'invite' }),
  ]
  const out = auditRooms(mixed).findings.filter((f) => f.roomId === '!s:x.net' && f.kind === 'outlier')
  check('a lone space is not an outlier against the rooms', out.length === 0, out)
}

console.log('\n-- who holds power, in the window --')
{
  const r = room({
    users: [
      { userId: '@zed:x.net', level: 100 },
      { userId: '@amy:x.net', level: 100 },
      { userId: '@bob:x.net', level: 50 },
      { userId: '@cat:x.net', level: 10 },
      { userId: '@dan:x.net', level: 0 },
    ],
  })
  const names = (low: number, high: number) => usersInRange(r, low, high).map((u) => u.userId).join(',')

  check('ranked by power, then alphabetical inside a rank',
    names(0, 100) === '@amy:x.net,@zed:x.net,@bob:x.net,@cat:x.net,@dan:x.net')
  // Inclusive at both ends: a floor of 50 is a question about moderators, and
  // excluding exactly 50 answers a different question.
  check('the floor is inclusive', names(50, 100) === '@amy:x.net,@zed:x.net,@bob:x.net')
  check('the ceiling is inclusive', names(0, 10).includes('@cat:x.net'))
  check('the ceiling excludes above it', !names(0, 50).includes('@zed:x.net'))
  check('the default window catches a voiced user and an owner',
    names(10, 100) === '@amy:x.net,@zed:x.net,@bob:x.net,@cat:x.net')
  check('an empty window is empty', names(101, 200) === '')
}

console.log('\n-- a window entered backwards is a typo, not an empty list --')
{
  check('reversed ends are swapped', JSON.stringify(normaliseRange(100, 10)) === '{"low":10,"high":100}')
  check('a proper window is left alone', JSON.stringify(normaliseRange(10, 50)) === '{"low":10,"high":50}')
  check('NaN falls back to the default', normaliseRange(Number.NaN, 50).low === 10)
  check('fractions are rounded', normaliseRange(9.6, 50.2).low === 10)
}

console.log('\n-- the structure --')
{
  const space = room({ roomId: '!s:x.net', name: 'Community', isSpace: true })
  const sub = room({ roomId: '!sub:x.net', name: 'Archive', isSpace: true, parentIds: ['!s:x.net'] })
  const a = room({ roomId: '!a:x.net', name: 'zebra', parentIds: ['!s:x.net'] })
  const b = room({ roomId: '!b:x.net', name: 'alpha', parentIds: ['!s:x.net'] })
  const orphan = room({ roomId: '!o:x.net', name: 'orphan' })
  const rows = structure([a, orphan, space, b, sub])

  check('the space comes first', rows[0].room.roomId === '!s:x.net')
  check('its children are nested', rows[1].depth === 1)
  check('and alphabetised inside it',
    rows.filter((r) => r.depth === 1).map((r) => r.room.name).join(',') === 'alpha,Archive,zebra')
  check('the orphan is at the top level and last',
    rows[rows.length - 1].room.roomId === '!o:x.net' && rows[rows.length - 1].depth === 0)
  check('every room appears', new Set(rows.map((r) => r.room.roomId)).size === 5)
  check('a child space is not emitted twice at the top',
    rows.filter((r) => r.room.roomId === '!sub:x.net').length === 1)
}

console.log('\n-- a room in two spaces appears under both --')
{
  const s1 = room({ roomId: '!s1:x.net', name: 'One', isSpace: true })
  const s2 = room({ roomId: '!s2:x.net', name: 'Two', isSpace: true })
  const shared = room({ roomId: '!c:x.net', name: 'shared', parentIds: ['!s1:x.net', '!s2:x.net'] })
  const rows = structure([s1, s2, shared])
  check('it is listed under each parent',
    rows.filter((r) => r.room.roomId === '!c:x.net').length === 2)
  check('and each row names the parent it is under',
    rows.filter((r) => r.room.roomId === '!c:x.net').map((r) => r.underSpaceId).sort().join(',')
      === '!s1:x.net,!s2:x.net')
}

console.log('\n-- a cycle in the space graph does not hang --')
{
  // m.space.child and m.space.parent are independent state events and nothing
  // stops them describing a loop.
  //
  // The case that matters is a loop REACHABLE FROM A ROOT. A pair of spaces
  // each claiming the other as parent is not: neither is a root, so both fall
  // through to the orphan sweep and the walk never recurses at all -- which is
  // how the first version of this case passed with the depth guard deleted.
  // A space that is its own child is reachable and does recurse.
  const top = room({ roomId: '!top:x.net', name: 'Top', isSpace: true })
  const loop = room({ roomId: '!loop:x.net', name: 'Loop', isSpace: true, parentIds: ['!top:x.net', '!loop:x.net'] })
  const rows = structure([top, loop])
  check('it terminates', rows.length > 0 && rows.length < 100, rows.length)
  check('and the root is still shown once', rows.filter((r) => r.room.roomId === '!top:x.net').length === 1)

  // The mutual pair, kept as its own case now that it is known to exercise a
  // different path: both must still appear.
  const x = room({ roomId: '!x:x.net', name: 'X', isSpace: true, parentIds: ['!y:x.net'] })
  const y = room({ roomId: '!y:x.net', name: 'Y', isSpace: true, parentIds: ['!x:x.net'] })
  const pair = structure([x, y])
  check('a mutual pair with no root still lists both',
    new Set(pair.map((r) => r.room.roomId)).size === 2, pair.length)
}

console.log('\n-- findings for one room, faults first --')
{
  const bad = room({ roomId: '!bad:x.net', usersDefault: 10, users: [] })
  const a = auditRooms([bad])
  const list = findingsFor(a, '!bad:x.net')
  check('both faults are there', list.length >= 2, list)
  check('every one belongs to that room', list.every((f) => f.roomId === '!bad:x.net'))
  check('hard findings come before outliers',
    list.every((f, i) => i === 0 || f.kind !== 'hard' || list[i - 1].kind === 'hard'))
  check('another room gets nothing', findingsFor(a, '!other:x.net').length === 0)
}

console.log('\n-- room ordering is total --')
{
  const r1 = room({ roomId: '!a:x.net', name: 'general' })
  const r2 = room({ roomId: '!b:x.net', name: 'General' })
  // Two rooms with the same name must not swap places between renders.
  check('same name falls back to the id', compareRooms(r1, r2) < 0)
  check('and is antisymmetric', compareRooms(r2, r1) > 0)
  check('a user comparison is antisymmetric too',
    compareUsers({ userId: '@a:x.net', level: 50 }, { userId: '@b:x.net', level: 100 }) > 0)
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
