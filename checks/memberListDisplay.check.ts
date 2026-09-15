// Checks for the user list's two displays (ui-depth-v1 U9).
//
// The relationship the operator specified is the thing worth pinning: the
// COMPACT list is the low-animation version of the rich one, not a third
// setting. So low-animation is an OVERRIDE over the preference, the preference
// survives it, and the panel can tell the difference -- which is what stops the
// switch reading as broken when motion is turned down.
import {
  densityOverridden,
  effectiveDensity,
  honorificPulses,
  nextDensity,
} from '../src/ui/memberListDisplay.ts'

let failures = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

console.log('\n-- low animation forces the compact list --')
{
  check('rich preference, motion on -> rich', effectiveDensity('rich', false) === 'rich')
  check('rich preference, motion down -> compact', effectiveDensity('rich', true) === 'compact')
  check('compact preference is compact either way',
    effectiveDensity('compact', false) === 'compact' && effectiveDensity('compact', true) === 'compact')
}

console.log('\n-- the preference survives the override --')
{
  // The override must not WRITE the preference. Somebody who turns motion off
  // for an afternoon and back on again gets their list back; a version that
  // overwrote the stored value would silently make the choice permanent.
  check('the override is reported as an override', densityOverridden('rich', true))
  check('and is not reported when nothing is overridden',
    !densityOverridden('rich', false) && !densityOverridden('compact', true))
  // Nothing here can write; the store is the only writer. Stated as a case
  // because the first sketch of this had effectiveDensity() calling set().
  check('asking twice gives the same answer', effectiveDensity('rich', true) === effectiveDensity('rich', true))
}

console.log('\n-- the toggle is a toggle --')
{
  check('rich flips to compact', nextDensity('rich') === 'compact')
  check('compact flips to rich', nextDensity('compact') === 'rich')
  check('twice is a round trip', nextDensity(nextDensity('rich')) === 'rich')
}

console.log('\n-- which honorifics pulse --')
{
  const pulse = (density: 'rich' | 'compact', presence: 'online' | 'offline' | 'unavailable' | undefined, honorific: string | null) =>
    honorificPulses({ density, presence, honorific })

  check('an online moderator in the rich list pulses', pulse('rich', 'online', '@'))
  check('an online owner pulses', pulse('rich', 'online', '~'))
  check('an online voice pulses', pulse('rich', 'online', '+'))

  // The compact list is the one that exists to be still.
  check('nothing pulses in the compact list', !pulse('compact', 'online', '@'))

  // A member with no rank has no glyph to pulse.
  check('a plain member has nothing to pulse', !pulse('rich', 'online', null))

  // W4.5: absent presence means the server said NOTHING, which is not offline.
  // Pulsing on absent would light up the whole list on a server that does not
  // report presence at all.
  check('unknown presence does not pulse', !pulse('rich', undefined, '@'))
  check('offline does not pulse', !pulse('rich', 'offline', '@'))
  check('away does not pulse', !pulse('rich', 'unavailable', '@'))
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
