// Checks for the power-level editor's rules (ui-depth-v1 U7).
//
// These are the HOMESERVER's rules, restated client-side, and the failure mode
// if they are restated wrongly is not a wrong answer -- it is a control that
// looks live and then 403s. So the cases that matter are the ones where the
// client must refuse BEFORE the server does, and the one place the obvious
// rule is wrong (you may always lower your own level, even though you may
// never touch anyone else standing at your height).
import { readFileSync } from 'node:fs'
import {
  powerEdit,
  requiredToSetPower,
  TIERS,
  DEFAULT_STATE_LEVEL,
  PRE_HYDRA_ROOM_VERSIONS,
  describePowerError,
  hydraCreators,
  levelIn,
  rateLimitWaitMs,
  refusal,
  standing,
  withUserLevel,
} from '../src/client/powerLevels.ts'

let failures = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const base = {
  isSelf: false,
  haveRoom: true,
  inRoom: true,
  myLevel: 100,
  targetLevel: 0,
  requiredToSet: 50,
  isSpace: false,
  targetIsCreator: false,
}
const at = (over: Partial<typeof base>) => powerEdit({ ...base, ...over })
const levels = (f: ReturnType<typeof powerEdit>) => f.options.map((o) => o.level).join(',')

console.log('\n-- the ordinary case --')
{
  const f = at({})
  check('an owner may set anyone below them to any rank', f.blocked === null)
  check('and the ranks offered are all four', levels(f) === '0,25,50,100')
  check('the current level is reported back', f.current === 0)
}

console.log('\n-- you cannot promote above yourself --')
{
  const mod = at({ myLevel: 50 })
  check('a moderator is not offered Owner', levels(mod) === '0,25,50')
  check('a moderator may still act', mod.blocked === null)

  const voice = at({ myLevel: 25, requiredToSet: 25 })
  check('a voiced user who may send the event is offered only up to their own level',
    levels(voice) === '0,25')
}

console.log('\n-- you cannot touch someone at or above your own level --')
{
  const equal = at({ myLevel: 50, targetLevel: 50 })
  check('an equal is refused', equal.blocked !== null)
  check('and the refusal names both numbers, not just "no"',
    !!equal.blocked && equal.blocked.includes('50'))
  check('no options are offered alongside a refusal', equal.options.length === 0)

  const above = at({ myLevel: 50, targetLevel: 100 })
  check('somebody above is refused', above.blocked !== null)
}

console.log('\n-- the exception: your own level is yours to lower --')
{
  // The rule above says "at or above your own level", and you are exactly at
  // your own level. Applied naively, an owner could never step down, which is
  // both wrong and the only way a handover ever happens.
  const self = at({ isSelf: true, myLevel: 100, targetLevel: 100 })
  check('you may step down', self.blocked === null)
  check('the ranks offered are the ones BELOW you', levels(self) === '0,25,50')
  check('your own level is not offered -- it is a no-op',
    !self.options.some((o) => o.level === 100))
  check('and it warns, because nothing undoes it', self.warning !== null)

  const floor = at({ isSelf: true, myLevel: 0, targetLevel: 0, requiredToSet: 0 })
  check('at the bottom there is nothing to step down to', floor.blocked !== null)
}

console.log('\n-- the promotion that cannot be undone is flagged --')
{
  const toEqual = at({ myLevel: 50, targetLevel: 0 })
  check('offering someone your own level warns about it', toEqual.warning !== null)
  check('and the warning names the level', !!toEqual.warning && toEqual.warning.includes('50'))
}

console.log('\n-- the two ways there is nothing to edit --')
{
  const noRoom = at({ haveRoom: false })
  check('with no room open, it says so', noRoom.blocked !== null)
  check('and says why a level needs one', !!noRoom.blocked && noRoom.blocked.includes('room'))

  // Matrix will happily record a power level for a user who is not in the
  // room. It reads as working and does nothing anyone can see.
  const outside = at({ inRoom: false })
  check('somebody not in the room has no level here', outside.blocked !== null)
  check('and the remedy is named', !!outside.blocked && outside.blocked.toLowerCase().includes('invite'))
}

console.log('\n-- not enough power to send the event at all --')
{
  const weak = at({ myLevel: 25, requiredToSet: 50 })
  check('below the requirement, refused', weak.blocked !== null)
  check('the refusal names the requirement AND what you have',
    !!weak.blocked && weak.blocked.includes('50') && weak.blocked.includes('25'))

  // A room that demands 100 to change levels is legal and not rare.
  const locked = at({ myLevel: 50, requiredToSet: 100 })
  check('a room that requires 100 refuses a 50', locked.blocked !== null)
}

console.log('\n-- a space says space --')
{
  const s = at({ haveRoom: false, isSpace: true })
  check('the wording follows the kind of room', !!s.blocked && s.blocked.includes('space'))
  const r = at({ haveRoom: false, isSpace: false })
  check('and a room says room', !!r.blocked && r.blocked.includes('room'))
}

console.log('\n-- reading the requirement out of room state --')
{
  check('the event override wins',
    requiredToSetPower({ events: { 'm.room.power_levels': 75 }, state_default: 50 }) === 75)
  check('state_default is the fallback',
    requiredToSetPower({ state_default: 60 }) === 60)
  check('with neither, the spec default',
    requiredToSetPower({}) === DEFAULT_STATE_LEVEL)

  // Server data. A malformed power_levels event must never read as "anyone may
  // do anything" -- the safe failure is to demand the default, not zero.
  check('null is the default', requiredToSetPower(null) === DEFAULT_STATE_LEVEL)
  check('a string is the default', requiredToSetPower('50') === DEFAULT_STATE_LEVEL)
  check('a non-numeric override is the default',
    requiredToSetPower({ events: { 'm.room.power_levels': 'high' } }) === DEFAULT_STATE_LEVEL)
  check('NaN is the default',
    requiredToSetPower({ state_default: Number.NaN }) === DEFAULT_STATE_LEVEL)
  check('events not being an object is the default',
    requiredToSetPower({ events: 7, state_default: 40 }) === 40)
  // Zero is a real level and must survive, which a truthiness test would eat.
  check('state_default of 0 is honoured, not treated as absent',
    requiredToSetPower({ state_default: 0 }) === 0)
}

console.log('\n-- the tiers match the glyphs the rest of the client draws --')
{
  // members.ts turns 100 / 50 / 25 into ~ / @ / +. A tier here with no glyph
  // there would be a rank nobody could see in the member list.
  check('the thresholds are 0, 25, 50, 100',
    TIERS.map((t) => t.level).join(',') === '0,25,50,100')
  check('they ascend', TIERS.every((t, i) => i === 0 || t.level > TIERS[i - 1].level))
  check('every tier has a label', TIERS.every((t) => t.label.length > 0))
}

console.log('\n-- a room-version-12 creator: nobody sets their level --')
{
  // The SDK reports a creator's level as Infinity. Every tier is below it, so
  // without the creator fact the editor offered a creator four live step-down
  // buttons that the write then always refused -- as "They created this room",
  // about themselves -- and showed others "They are at level Infinity".
  const self = at({ isSelf: true, myLevel: Infinity, targetLevel: Infinity, targetIsCreator: true })
  check('a creator looking at themselves gets no controls', self.options.length === 0 && self.blocked !== null, self)
  check('and is told it is THEIR creation, with no talk of stepping down',
    /^You created/.test(self.blocked ?? '') && self.warning === null, self)
  const other = at({ myLevel: 100, targetLevel: Infinity, targetIsCreator: true })
  check('anyone else looking at a creator gets no controls, and the reason', other.options.length === 0 && /^They created/.test(other.blocked ?? ''), other)
  check('no sentence mentions Infinity', ![self.blocked, other.blocked, self.warning, other.warning].some((s) => /Infinity/.test(s ?? '')))
  const byCreator = at({ myLevel: Infinity, targetLevel: 0 })
  check('a creator setting someone else is offered every rank', levels(byCreator) === '0,25,50,100' && byCreator.blocked === null, byCreator)
}

console.log('\n-- one set of rules: the editor and the bulk setter agree --')
{
  // powerEdit's options must be exactly the tiers refusal() accepts, for every
  // combination -- the two surfaces must never disagree about one room.
  let disagreements = 0
  for (const myLevel of [0, 25, 50, 75, 100]) for (const targetLevel of [0, 25, 50, 100]) for (const requiredToSet of [0, 50, 100]) for (const isSelf of [false, true]) {
    const i = { isSelf, haveRoom: true, inRoom: true, myLevel, targetLevel: isSelf ? myLevel : targetLevel, requiredToSet, isSpace: false, targetIsCreator: false }
    const f = powerEdit(i)
    const accepted = TIERS.filter((t) => refusal(i, t.level) === null && !(isSelf && t.level >= myLevel)).map((t) => t.level).join(',')
    const offered = f.options.map((o) => o.level).join(',')
    if (offered !== accepted) disagreements++
    // Whenever the shared rules refuse, the editor shows that same refusal.
    const s2 = standing(i)
    if (s2 !== null && f.blocked !== s2) disagreements++
  }
  check('powerEdit offers exactly what refusal accepts, across 120 rooms', disagreements === 0, disagreements)
  check('a level above your own is refused with both numbers',
    /75.*50/.test(refusal({ isSelf: false, myLevel: 50, targetLevel: 0, requiredToSet: 50, isSpace: false }, 75) ?? ''))
  check('a fraction is refused', refusal({ isSelf: false, myLevel: 100, targetLevel: 0, requiredToSet: 50, isSpace: false }, 50.5) !== null)
}

console.log('\n-- room version 12 creators, by the SDK\'s own rule --')
{
  // The SDK decides member levels with this list (utils/roomVersion.ts). A
  // second copy here must be the same copy, or a new room version would give
  // the Rooms view and the bulk setter different answers than the member list.
  const sdk = readFileSync(new URL('../node_modules/matrix-js-sdk/src/utils/roomVersion.ts', import.meta.url), 'utf8')
  const theirs = /PRE_HYDRA_ROOM_VERSIONS = \[([^\]]*)\]/.exec(sdk)?.[1].split(',').map((v) => v.trim().replace(/"/g, '')) ?? []
  check('the pre-hydra list is the SDK\'s', theirs.length > 0 && theirs.join(',') === PRE_HYDRA_ROOM_VERSIONS.join(','), { theirs, ours: PRE_HYDRA_ROOM_VERSIONS })
  check('version 11: nobody is a creator in this sense', hydraCreators('11', '@a:x', { additional_creators: ['@b:x'] }).length === 0)
  check('no version named is version 1', hydraCreators(undefined, '@a:x', {}).length === 0)
  check('version 12: the sender and the additional creators',
    hydraCreators('12', '@a:x', { additional_creators: ['@b:x', 7, '@a:x'] }).join(',') === '@a:x,@b:x')
  check('an unknown version is treated as hydra, as the SDK does', hydraCreators('org.example.13', '@a:x', {}).join(',') === '@a:x')
}

console.log('\n-- reading a level out of raw content --')
{
  const c = { users: { '@a:x': 50, '@f:x': 12.5 }, users_default: 10 }
  check('their own entry', levelIn(c, '@a:x') === 50)
  check('else the room default', levelIn(c, '@b:x') === 10)
  check('a non-integer entry is not a level (the SDK ignores it too)', levelIn(c, '@f:x') === 10)
  check('else 0', levelIn({}, '@b:x') === 0 && levelIn(null, '@b:x') === 0)
  check('a creator is unlimited', levelIn(c, '@a:x', ['@a:x']) === Infinity)
}

console.log('\n-- the write changes one entry and nothing else --')
{
  const before = {
    users: { '@a:x': 100, '@b:x': 25 },
    users_default: 0,
    events: { 'm.room.power_levels': 100, 'net.41chan.media.tags': 10 },
    notifications: { room: 50 },
    state_default: 50,
  }
  const snapshot = JSON.stringify(before)
  const after = withUserLevel(before, '@c:x', 50)
  check('the new entry is there', (after.users as Record<string, number>)['@c:x'] === 50)
  check('everything else is identical', JSON.stringify({ ...after, users: { ...(after.users as object), '@c:x': undefined } }) === JSON.stringify({ ...before, users: { ...before.users, '@c:x': undefined } }))
  check('the input is not touched (it is usually the SDK\'s own state)', JSON.stringify(before) === snapshot)
  check('a room with no users map gets one', JSON.stringify(withUserLevel({ state_default: 50 }, '@c:x', 25).users) === '{"@c:x":25}')
}

console.log('\n-- a failed change is described as a power change --')
{
  const forbidden = describePowerError({ errcode: 'M_FORBIDDEN', httpStatus: 403, data: { error: "You don't have permission to add ops level greater than your own" } })
  check('a 403 says the server refused, quotes it, names the remedy, and never says invite',
    /refused/.test(forbidden) && /greater than your own/.test(forbidden) && /re-read/i.test(forbidden) && !/invite/i.test(forbidden), forbidden)
  check('a rate limit says to wait', /wait/i.test(describePowerError({ errcode: 'M_LIMIT_EXCEEDED', httpStatus: 429 })))
  check('no answer at all is the network', /reached/.test(describePowerError(new TypeError('Failed to fetch'))))
  check('a space says space', /space/.test(describePowerError({ errcode: 'M_FORBIDDEN', httpStatus: 403 }, true)))
}

console.log('\n-- how long a rate limit asks for --')
{
  check('not rate-limited: null', rateLimitWaitMs({ errcode: 'M_FORBIDDEN', httpStatus: 403 }) === null)
  check('the body field', rateLimitWaitMs({ errcode: 'M_LIMIT_EXCEEDED', data: { retry_after_ms: 900 } }) === 900)
  check('the SDK\'s own reading wins when it has one', rateLimitWaitMs({ httpStatus: 429, getRetryAfterMs: () => 4000, data: { retry_after_ms: 900 } }) === 4000)
  check('a header the SDK cannot read falls back to the body', rateLimitWaitMs({ httpStatus: 429, getRetryAfterMs: () => { throw new Error('bad') }, data: { retry_after_ms: 700 } }) === 700)
  check('asked for nothing: 0, and the caller picks the wait', rateLimitWaitMs({ httpStatus: 429 }) === 0)
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
