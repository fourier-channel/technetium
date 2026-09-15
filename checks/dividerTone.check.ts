// Checks for which colour a divider wears (ui-depth-v1 U2).
//
// The rule is worth pinning because it is NOT "highlight whatever is open":
// the operator's example explicitly wants the thread view's RIGHT wall to stay
// green while the thread view is out, which "either neighbour is active" would
// get wrong. The cases below are that example, transcribed, plus the ways the
// naive rule would differ from it.
import { defaultSpace, openDomain, closeDomain, openThreadView, closeThreadView, openInColumn, closeInColumn, setViewport } from '../src/ui/space.ts'

// Two traps, both found by writing the cases first and watching them fail
// (VERIFICATION-DOCTRINE rule 2), and both of which would have made every case
// below pass against a space where NOTHING was ever open:
//
//   1. The open helpers take a FRACTION of the region. Called without one, the
//      arithmetic goes NaN, the feasibility test refuses it, and the helper
//      hands back the space unchanged rather than throwing.
//   2. Panel minimums are in PIXELS since 2026-09-06, so on the default
//      1440x900 viewport a thread view at 0.25 of the region is under its
//      minimum and the open is refused -- correctly, and nothing to do with
//      tone. These cases run on a deliberately huge screen for the same reason
//      space.check.ts does: so a minimum can never be what is being measured.
const base = () => setViewport(defaultSpace(), { w: 3600, h: 2200 })
import { dividerTone, isPulledOutPanel, PULLED_OUT_PANELS } from '../src/ui/dividerTone.ts'

let failures = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

console.log('\n-- which panels are pulled out, and which are furniture --')
{
  check('the domain is pulled out', isPulledOutPanel('domain'))
  check('the thread view is pulled out', isPulledOutPanel('thread'))
  check('the thread strip is pulled out', isPulledOutPanel('threads'))
  check('the DM dock is pulled out', isPulledOutPanel('dock'))

  // The three that are simply THERE. A user who has touched nothing is looking
  // at all of them, so none of them is ever "something is going on here".
  check('the room list is furniture', !isPulledOutPanel('sidebar'))
  check('the conversation is furniture', !isPulledOutPanel('main'))
  check('the member list is furniture', !isPulledOutPanel('members'))

  check('every id in the set is distinct', new Set(PULLED_OUT_PANELS).size === PULLED_OUT_PANELS.length)
}

console.log('\n-- the operator example, transcribed --')
{
  // "pulling out domain mode changes domain's left divider to orange. the
  //  right side would still be green"
  const s = openDomain(base(), 0.32)
  check('the domain out turns the domain wall active', dividerTone(s, 'domain') === 'active')
  check('and the wall on its other side stays neutral', dividerTone(s, 'members') === 'neutral')

  // "unless thread view is also open. in that case, left domain wall is
  //  orange, the shared wall is orange, and thread view's right wall is green"
  //
  // BUILT BY HAND, and that is a finding rather than a convenience: with the
  // domain open, openThreadView REFUSES at every fraction and on every screen
  // size, because it takes the whole of the thread view's width from the
  // panels whose right edge touches the region -- which, once the domain is
  // out, is only the domain, and the domain cannot spare that much above its
  // own minimum. So the state the operator describes is currently unreachable
  // in the app. That is a layout-model bug, logged as U2b in the campaign
  // ledger, and NOT a fact about tone; the tone rule is asserted here against
  // the state directly so that fixing one cannot quietly hide the other.
  const both = { ...s, leaves: { ...s.leaves, thread: { ...s.leaves.thread, open: true } } }
  check('with the thread view out too, the domain wall is still active',
    dividerTone(both, 'domain') === 'active')
  check('the wall they SHARE is active -- it is the thread view\'s own',
    dividerTone(both, 'thread') === 'active')
  check('and the member list wall, which is the thread view\'s right wall, stays neutral',
    dividerTone(both, 'members') === 'neutral')
}

console.log('\n-- the naive rule this is not --')
{
  // "either neighbour is open" would light the member list's wall the moment
  // the thread view came out, because the thread view is its left neighbour.
  // That is precisely the case the operator called green.
  const s = openThreadView(base(), 0.38)
  check('a pulled-out panel does not colour the wall on its far side',
    dividerTone(s, 'members') === 'neutral')

  // "anything open is active" would light every wall on the screen, since the
  // room list and the conversation are always open.
  const fresh = base()
  check('an always-open panel is never active', dividerTone(fresh, 'sidebar') === 'neutral')
  check('the conversation is never active', dividerTone(fresh, 'main') === 'neutral')
}

console.log('\n-- closing puts it back --')
{
  const opened = openDomain(base(), 0.32)
  const closed = closeDomain(opened)
  check('closing the domain returns its wall to neutral', dividerTone(closed, 'domain') === 'neutral')

  const t = openThreadView(base(), 0.38)
  check('the thread view opens on its own', t.leaves.thread.open)
  check('the thread view out is active', dividerTone(t, 'thread') === 'active')
  check('closed again is neutral', dividerTone(closeThreadView(t), 'thread') === 'neutral')

  const dock = openInColumn(base(), 'dock', 0.28)
  check('the dock out is active', dividerTone(dock, 'dock') === 'active')
  check('the dock closed is neutral', dividerTone(closeInColumn(dock, 'dock'), 'dock') === 'neutral')
}

console.log('\n-- a pulled-out panel that is CLOSED is quiet, not absent --')
{
  // The grip goes away with its panel, so this is mostly a statement that the
  // function never reports active for something nobody can see.
  const s = base()
  for (const id of PULLED_OUT_PANELS) {
    if (!s.leaves[id].open) {
      check(`${id} closed reads neutral`, dividerTone(s, id) === 'neutral')
    }
  }
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
