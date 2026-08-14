// Checks for the interaction catalog and its wire rules.
//
// The wire rules are the ones that stop a hostile or buggy client making
// everyone else's chat unusable, so they get the hostile cases rather than the
// happy path: a forged actor, a future timestamp, an action belonging to the
// other surface, a target where there should not be one.
import {
  INTERACTIONS,
  MAX_INTERACTION_MS,
  interactionById,
  interactionPhrase,
  interactionsFor,
} from '../src/client/interactionCatalog.ts'
import {
  FRESH_WINDOW_MS,
  RATE_LIMIT_MS,
  parseInteraction,
  rateLimitOk,
} from '../src/client/interactionEvents.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const NOW = 1_800_000_000_000
const ACTOR = '@a:x.net'
const TARGET = '@b:x.net'

const parse = (content: unknown, over: Record<string, unknown> = {}) =>
  parseInteraction({
    content,
    sender: ACTOR,
    eventId: '$evt',
    ts: NOW,
    now: NOW,
    surface: 'chat',
    ...over,
  } as any)

console.log('\n-- catalog integrity --')
{
  const ids = INTERACTIONS.map((i) => i.id)
  check('ids are unique', new Set(ids).size === ids.length)
  check('every entry has at least one surface', INTERACTIONS.every((i) => i.surfaces.length > 0))
  check('every entry has a positive duration', INTERACTIONS.every((i) => i.durationMs > 0))
  check('every entry has a glyph and a label', INTERACTIONS.every((i) => !!i.glyph && !!i.label))
  // The phrase is the reduced-motion fallback and the screen-reader text, so a
  // targeted entry that never says who it hit is a real gap.
  check(
    'every targeted phrase names the target',
    INTERACTIONS.filter((i) => i.shape === 'targeted').every((i) => i.phrase.includes('{target}')),
  )
  check('every phrase names the actor', INTERACTIONS.every((i) => i.phrase.includes('{actor}')))
  check(
    'no self phrase pretends to have a target',
    INTERACTIONS.filter((i) => i.shape === 'self').every((i) => !i.phrase.includes('{target}')),
  )
  check('lookup by id works', interactionById('slap')?.label === 'Slap')
  check('an unknown id is null, not undefined-ish', interactionById('nope') === null)
  check('chat surface excludes canvas-only actions', !interactionsFor('chat').some((i) => i.id === 'square'))
  check('domain surface includes them', interactionsFor('domain').some((i) => i.id === 'square'))
  check('both surfaces have entries', interactionsFor('chat').length > 0 && interactionsFor('domain').length > 0)
  // MAX bounds how long an instance may sit in state; if it under-reported,
  // the longest animation would be culled mid-play.
  check(
    'MAX_INTERACTION_MS covers the longest entry',
    MAX_INTERACTION_MS === Math.max(...INTERACTIONS.map((i) => i.durationMs)),
  )
}

console.log('\n-- phrases --')
{
  const slap = interactionById('slap')!
  check('substitutes both names', interactionPhrase(slap, 'Ali', 'Bee') === '{actor} slapped {target} with an elastic sticky hand'.replace('{actor}', 'Ali').replace('{target}', 'Bee'))
  check('a missing target degrades to "someone"', interactionPhrase(slap, 'Ali').includes('someone'))
}

console.log('\n-- the actor is the SENDER, never the content (D-in02) --')
{
  // The whole point: a content field claiming to be someone else is ignored.
  const forged = parse({ id: '$1', action: 'wave', actor: '@victim:x.net', sender: '@victim:x.net' })
  check('a forged actor field is ignored', forged?.actor === ACTOR, forged?.actor)
  check('no sender means no interaction', parse({ id: '$1', action: 'wave' }, { sender: null }) === null)
  check('an empty sender is rejected', parse({ id: '$1', action: 'wave' }, { sender: '' }) === null)
}

console.log('\n-- shape invariants --')
{
  const ok = parse({ id: '$1', action: 'slap', target: TARGET })
  check('a targeted interaction parses', ok?.action === 'slap' && ok?.target === TARGET)
  check('targeted WITHOUT a target is rejected', parse({ id: '$1', action: 'slap' }) === null)
  // Rejected rather than coerced, so the renderer can rely on the invariant.
  check('self WITH a target is rejected', parse({ id: '$1', action: 'wave', target: TARGET }) === null)
  check('a self interaction parses', parse({ id: '$1', action: 'wave' })?.target === undefined)
  check(
    'an over-long target is rejected',
    parse({ id: '$1', action: 'slap', target: 'x'.repeat(300) }) === null,
  )
}

console.log('\n-- surface gating --')
{
  check('a canvas-only action is refused in chat', parse({ id: '$1', action: 'square' }) === null)
  check(
    'and accepted on the canvas',
    parse({ id: '$1', action: 'square' }, { surface: 'domain' })?.action === 'square',
  )
  check('an unknown action is refused', parse({ id: '$1', action: 'nuke', target: TARGET }) === null)
}

console.log('\n-- freshness --')
{
  check('a current event plays', parse({ id: '$1', action: 'wave' }) !== null)
  check(
    'just inside the window plays',
    parse({ id: '$1', action: 'wave' }, { ts: NOW - (FRESH_WINDOW_MS - 100) }) !== null,
  )
  check(
    'stale history does NOT replay',
    parse({ id: '$1', action: 'wave' }, { ts: NOW - (FRESH_WINDOW_MS + 1) }) === null,
  )
  check(
    'ancient history does not replay',
    parse({ id: '$1', action: 'wave' }, { ts: NOW - 90 * 24 * 3600_000 }) === null,
  )
  // A client choosing its own future timestamp must not be able to pin an
  // animation on everyone's screen.
  check(
    'a far-future timestamp is refused',
    parse({ id: '$1', action: 'wave' }, { ts: NOW + FRESH_WINDOW_MS + 1 }) === null,
  )
  check(
    'a NaN timestamp is refused',
    parse({ id: '$1', action: 'wave' }, { ts: Number.NaN }) === null,
  )
}

console.log('\n-- malformed content --')
{
  check('null content', parse(null) === null)
  check('a string body', parse('slap') === null)
  check('an array', parse([]) === null)
  check('no action', parse({ id: '$1' }) === null)
  check('a non-string action', parse({ id: '$1', action: 42 }) === null)
  check('an over-long action is refused', parse({ id: '$1', action: 'a'.repeat(200) }) === null)
  // No instance id on the wire: fall back to the event id so it can still dedup.
  check('falls back to the event id', parse({ action: 'wave' })?.key === '$evt')
  check('no id anywhere is refused', parse({ action: 'wave' }, { eventId: null }) === null)
}

console.log('\n-- rate limit (D-in03: the RECEIVER enforces it too) --')
{
  check('a first interaction is allowed', rateLimitOk(undefined, NOW))
  check('a second one immediately after is refused', !rateLimitOk(NOW, NOW))
  check('still refused just inside the window', !rateLimitOk(NOW - (RATE_LIMIT_MS - 1), NOW))
  check('allowed once the window has passed', rateLimitOk(NOW - RATE_LIMIT_MS, NOW))
  check('allowed long after', rateLimitOk(NOW - 60_000, NOW))
  // A clock that jumps backwards must not unlock the gate -- otherwise the
  // limit is bypassable by anyone willing to set their clock wrong.
  check('a backwards clock jump does not unlock it', !rateLimitOk(NOW + 10_000, NOW))
}

console.log('\n-- the domain registry is DERIVED, and stays wire-compatible --')
{
  // useDomainActions pulls in React; fine in the harness, but import it lazily
  // so the pure checks above run even if that ever stops being true.
  const { ACTION_REGISTRY } = await import('../src/client/useDomainActions.ts')
  const domain = interactionsFor('domain')

  check('every domain catalog entry is in the registry',
    domain.every((i) => !!ACTION_REGISTRY[i.id]),
    domain.filter((i) => !ACTION_REGISTRY[i.id]).map((i) => i.id))
  check('the registry adds nothing the catalog does not have',
    Object.keys(ACTION_REGISTRY).length === domain.length)
  check('chat-only actions are NOT in the canvas registry', !ACTION_REGISTRY.boop || domain.some((i) => i.id === 'boop'))

  // The canvas knows exactly two renderers; a shape that maps to neither would
  // render nothing at all.
  check('every kind is one the canvas can render',
    Object.values(ACTION_REGISTRY).every((d: any) => d.kind === 'self' || d.kind === 'throw'))
  check('targeted maps to the arc renderer', ACTION_REGISTRY.throw?.kind === 'throw')
  check('self maps to the anchored renderer', ACTION_REGISTRY.square?.kind === 'self')

  // BACKWARDS COMPATIBILITY. 'square' and 'throw' are what the DEPLOYED client
  // sends. Renaming or dropping either would make live clients emit events this
  // one silently ignores -- and the failure would look like "actions stopped
  // working for some people".
  check("the deployed id 'square' still exists", !!ACTION_REGISTRY.square)
  check("the deployed id 'throw' still exists", !!ACTION_REGISTRY.throw)

  check('every registry entry has a glyph and a positive duration',
    Object.values(ACTION_REGISTRY).every((d: any) => !!d.glyph && d.durationMs > 0))
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
