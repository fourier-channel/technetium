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
import {
  anchorPoint,
  anchorsSatisfied,
  approachStart,
  arcMidpoint,
  arcSign,
} from '../src/ui/interactionGeometry.ts'

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

console.log('\n-- overlay geometry: the layer is not the scroller --')
{
  // The regression these exist for: the overlay was mounted INSIDE the
  // scroller, where `inset: 0` pins it to the top of the scrolled content
  // rather than to the visible box. Positions were still measured from the
  // scroller, so every play drew scrollTop pixels above the screen and was
  // clipped. Nothing failed, nothing errored, and nothing appeared.
  const scroller = { top: 100, bottom: 500, left: 0, width: 800, height: 400 }

  // The layer sits over the scroller: the two origins agree.
  const flush = anchorPoint(scroller, scroller, {
    top: 200, bottom: 220, left: 40, width: 60, height: 20,
  })
  check('an anchor is measured from the layer origin', flush?.x === 70 && flush?.y === 110)

  // The layer scrolled away with the content by 300px, which is what mounting
  // it inside the scroller did. The point must follow the LAYER, not the
  // scroller -- if this returns the same y as above, the origin is wrong again.
  const scrolledLayer = { top: -200, bottom: 200, left: 0, width: 800, height: 400 }
  const drifted = anchorPoint(scroller, scrolledLayer, {
    top: 200, bottom: 220, left: 40, width: 60, height: 20,
  })
  check('a displaced layer shifts the point by exactly its own offset',
    drifted?.y === 410 && drifted.y - (flush?.y ?? 0) === 300)

  // Visibility is still judged against the SCROLLER, never the layer.
  check('an anchor above the scroller band is dropped',
    anchorPoint(scroller, scroller, {
      top: 40, bottom: 60, left: 40, width: 60, height: 20,
    }) === null)
  check('an anchor below the scroller band is dropped',
    anchorPoint(scroller, scroller, {
      top: 600, bottom: 620, left: 40, width: 60, height: 20,
    }) === null)
  // Half-visible counts: a pill straddling the edge is still somewhere real.
  check('an anchor straddling the top edge is kept',
    anchorPoint(scroller, scroller, {
      top: 90, bottom: 110, left: 40, width: 60, height: 20,
    }) !== null)
  // A layer displaced out of the band must NOT change what is visible.
  check('the layer offset never decides visibility',
    anchorPoint(scroller, scrolledLayer, {
      top: 600, bottom: 620, left: 40, width: 60, height: 20,
    }) === null)
}

console.log('\n-- the arc is hashed, not random --')
{
  // Random would mean the sender and the receiver watch the same slap bow in
  // opposite directions. The play id is on the wire, so hashing it makes every
  // client stage the same event identically -- and keeps it out of render,
  // where a random read would violate the React Compiler rules (G-tc01).
  const key = '@a:x.net:1800000000000:slap'
  check('the same play id always picks the same side',
    arcSign(key) === arcSign(key) && arcSign(key) === arcSign('' + key))
  check('the side is only ever -1 or 1', [1, -1].includes(arcSign(key)))

  // Not a distribution test -- just proof it is not a constant dressed up as a
  // hash, which would make every interaction bow the same way forever.
  const sides = new Set(
    Array.from({ length: 40 }, (_, i) => arcSign(`@a:x.net:${1800000000000 + i}:slap`)),
  )
  check('different plays get different sides', sides.size === 2, [...sides])

  const from = { x: 100, y: 100 }
  const to = { x: 300, y: 100 }
  const left = arcMidpoint(from, to, -1)
  const right = arcMidpoint(from, to, 1)
  check('the arc passes over the midpoint on the x axis', left.x === 200 && right.x === 200)
  check('the two sides bow opposite ways', left.y < 100 && right.y > 100)
  check('the bow is symmetric', Math.abs(left.y - 100) === Math.abs(right.y - 100))

  // Perpendicular, not "up": a vertical flight has to bow SIDEWAYS or the arc
  // hides behind the travel. This is the case a hardcoded y-offset gets wrong.
  const vertical = arcMidpoint({ x: 100, y: 100 }, { x: 100, y: 300 }, 1)
  check('a vertical flight bows sideways', vertical.x !== 100 && vertical.y === 200)

  // A long flight must not leave the screen on its way across.
  const wide = arcMidpoint({ x: 0, y: 0 }, { x: 4000, y: 0 }, 1)
  check('the bow is capped on a long flight', Math.abs(wide.y) <= 120)
  // A short one must still visibly bow rather than reading as a straight line.
  const short = arcMidpoint({ x: 0, y: 0 }, { x: 20, y: 0 }, 1)
  check('a short flight still bows', Math.abs(short.y) >= 24)

  // Degenerate: slapping somebody standing exactly where you are. No direction
  // to be perpendicular to -- must not produce NaN and poison the CSS var.
  const same = arcMidpoint({ x: 50, y: 50 }, { x: 50, y: 50 }, 1)
  check('a zero-length flight is finite', Number.isFinite(same.x) && Number.isFinite(same.y))

  const target = { x: 500, y: 200 }
  check('an approach starts beside the target, level with it',
    approachStart(target, 1).y === 200 && approachStart(target, 1).x > 500)
  check('the other side starts on the other side', approachStart(target, -1).x < 500)
}

console.log('\n-- which anchors a choreography actually needs --')
{
  const p = { x: 1, y: 1 }
  // The regression this prevents: every targeted play once required BOTH ends,
  // so an approach was dropped whenever the actor had not spoken recently
  // enough to be on screen -- which is most of the time you want to poke
  // somebody. The actor's avatar is DRAWN for an approach, not located.
  check('an approach needs only the target', anchorsSatisfied('target', null, p))
  check('an approach without a target is still dropped', !anchorsSatisfied('target', p, null))
  check('a travel needs both ends', anchorsSatisfied('both', p, p))
  check('a travel with one end missing is dropped',
    !anchorsSatisfied('both', null, p) && !anchorsSatisfied('both', p, null))
  check('a self play needs only the actor', anchorsSatisfied('actor', p, null))
  check('a self play without the actor is dropped', !anchorsSatisfied('actor', null, p))

  // The catalog must agree with the renderer about what it is asking for: an
  // approach that claimed 'both' would reintroduce the bug above, and a travel
  // that claimed 'target' would draw a line from nowhere.
  check('every approach asks for the target only',
    INTERACTIONS.filter((i) => i.choreo === 'approach').every((i) => i.anchors === 'target'))
  check('every travel asks for both ends',
    INTERACTIONS.filter((i) => i.choreo === 'travel').every((i) => i.anchors === 'both'))
  check('every self play asks for the actor only',
    INTERACTIONS.filter((i) => i.choreo === 'self').every((i) => i.anchors === 'actor'))
  check('only self-shaped entries use the self choreography',
    INTERACTIONS.every((i) => (i.choreo === 'self') === (i.shape === 'self')))
}

console.log('\n-- unhurried: every interaction has room to be seen --')
{
  // The correction the arrival animations already took. Under about a second
  // the beats clip each other and the whole thing reads as a flicker rather
  // than as an event, which is what the operator saw first time round.
  check('nothing plays in under 1.4s', INTERACTIONS.every((i) => i.durationMs >= 1400),
    INTERACTIONS.filter((i) => i.durationMs < 1400).map((i) => i.id))
  // The slap's stick is ~40% of its duration; too short and there is no stick.
  const slap = interactionById('slap')
  check('the slap is long enough to stick', (slap?.durationMs ?? 0) >= 2000)
  // The receiver bounds an instance's lifetime by this, so it must cover the
  // longest definition or the longest animation gets cut off mid-play.
  check('MAX_INTERACTION_MS still covers the slowest',
    MAX_INTERACTION_MS === Math.max(...INTERACTIONS.map((i) => i.durationMs)))
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
