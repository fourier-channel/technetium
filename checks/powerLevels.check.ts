// Checks for the power-level editor's rules (ui-depth-v1 U7).
//
// These are the HOMESERVER's rules, restated client-side, and the failure mode
// if they are restated wrongly is not a wrong answer -- it is a control that
// looks live and then 403s. So the cases that matter are the ones where the
// client must refuse BEFORE the server does, and the one place the obvious
// rule is wrong (you may always lower your own level, even though you may
// never touch anyone else standing at your height).
import { powerEdit, requiredToSetPower, TIERS, DEFAULT_STATE_LEVEL } from '../src/client/powerLevels.ts'

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

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
