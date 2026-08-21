// Checks for guard: reflection, deflection, and the window.
//
// Every client works this out for itself from the guard event it already has
// (D-in09). Nothing on the wire says "this was reflected", because a sender who
// could set that flag could also decline to -- so these rules are the shield,
// and a hole here is a shield you can talk your way past.
import { GUARD_MS, applyGuard, guardActiveAt } from '../src/client/guard.ts'
import { INTERACTIONS, interactionById } from '../src/client/interactionCatalog.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const NOW = 1_800_000_000_000
const A = '@a:x.net'
const B = '@b:x.net'
const guarded = (who: string, until: number) => (u: string) =>
  u === who ? until : undefined
const nobody = () => undefined

console.log('\n-- the window --')
{
  check('a live guard is active', guardActiveAt(NOW + 10_000, NOW))
  check('an expired guard is not', !guardActiveAt(NOW - 1, NOW))
  check('exactly expired is not active', !guardActiveAt(NOW, NOW))
  check('no guard at all is not active', !guardActiveAt(undefined, NOW))

  // A guard set far in the FUTURE is refused for the same reason the freshness
  // gate rejects future timestamps: a client choosing its own clock could
  // otherwise hold a shield up permanently.
  check('a guard beyond the window is refused',
    !guardActiveAt(NOW + GUARD_MS + 1_000, NOW))
  check('a guard at exactly the window is honoured',
    guardActiveAt(NOW + GUARD_MS, NOW))
}

console.log('\n-- hostile things come back --')
{
  const out = applyGuard({ actor: A, target: B, hostile: true }, guarded(B, NOW + 5_000), NOW)
  check('a hostile play at a guarded person reflects', out.reflected)
  // The ends are SWAPPED, so the whole travel choreography is reused rather
  // than a second one being invented for "backwards".
  check('it now travels from the guarded person', out.actor === B)
  check('...back to whoever sent it', out.target === A)
  check('a reflected play is not also deflected', !out.deflected)
}

console.log('\n-- everything else is merely held off --')
{
  const out = applyGuard({ actor: A, target: B, hostile: false }, guarded(B, NOW + 5_000), NOW)
  check('a friendly play at a guarded person is deflected', out.deflected)
  check('it is not reflected', !out.reflected)
  // A hug should not be punished for arriving while somebody is defensive: it
  // still plays, it just does not reach them.
  check('the ends are unchanged', out.actor === A && out.target === B)
}

console.log('\n-- when nothing is guarding --')
{
  const out = applyGuard({ actor: A, target: B, hostile: true }, nobody, NOW)
  check('a hostile play lands normally', !out.reflected && !out.deflected)
  check('the ends are untouched', out.actor === A && out.target === B)

  const expired = applyGuard(
    { actor: A, target: B, hostile: true }, guarded(B, NOW - 1), NOW)
  check('an expired guard does not reflect', !expired.reflected)

  // The ACTOR's own guard is irrelevant -- a shield protects you from what is
  // aimed at you, not what you throw.
  const mine = applyGuard(
    { actor: A, target: B, hostile: true }, guarded(A, NOW + 5_000), NOW)
  check('your own guard does not reflect your own attack', !mine.reflected)
}

console.log('\n-- degenerate --')
{
  const selfPlay = applyGuard({ actor: A, target: undefined, hostile: false }, guarded(A, NOW + 5_000), NOW)
  check('a self play is never reflected', !selfPlay.reflected && !selfPlay.deflected)

  // Hitting yourself while guarded must not reflect: there is nowhere for it to
  // come back from, and a play from you to you renders as nothing at all.
  const selfHit = applyGuard({ actor: A, target: A, hostile: true }, guarded(A, NOW + 5_000), NOW)
  check('attacking yourself through your own guard does not reflect', !selfHit.reflected)
  check('it is deflected instead', selfHit.deflected)
  check('the ends are not swapped into nothing', selfHit.actor === A && selfHit.target === A)
}

console.log('\n-- the catalog agrees about what is hostile --')
{
  check('slap is hostile', interactionById('slap')?.hostile === true)
  check('squirt is hostile', interactionById('squirt')?.hostile === true)
  // Being aimed at somebody is not the same as being aimed at them with intent.
  check('hug is not hostile', !interactionById('hug')?.hostile)
  check('highfive is not hostile', !interactionById('highfive')?.hostile)
  check('guard itself is not hostile', !interactionById('guard')?.hostile)
  check('guard is a self action', interactionById('guard')?.shape === 'self')
  // Nothing that plays only beside its actor can be hostile -- there is no one
  // for it to be hostile TOWARD.
  check('no self action is hostile',
    INTERACTIONS.filter((i) => i.shape === 'self').every((i) => !i.hostile))
  check('squirt reaches the chat surface',
    !!interactionById('squirt')?.surfaces.includes('chat'))
  check('guard reaches the chat surface',
    !!interactionById('guard')?.surfaces.includes('chat'))
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
