import type { PanelId, Space } from './space'

// ---------------------------------------------------------------------------
// What colour a divider wears (ui-depth-v1 U2).
//
// A divider BELONGS TO THE PANEL ON ITS RIGHT -- or, for a horizontal one, the
// panel ABOVE it. That is not an arbitrary choice: it is where the tree already
// puts them. Every panel that comes out of an edge renders its own grip
// immediately before itself, so the grip and the panel are one object and the
// divider is that panel's leading edge.
//
// The rule, from the operator's worked example of 2026-09-15:
//
//   "pulling out domain mode changes domain's left divider to orange. the
//    right side would still be green, unless thread view is also open. in that
//    case, left domain wall is orange, the shared wall is orange, and thread
//    view's right wall is green."
//
// Both halves follow from one sentence: a divider is ACTIVE while the panel it
// leads is a panel that gets pulled out and is currently out, and NEUTRAL
// otherwise. The wall shared by the domain and the thread view is the thread
// view's own left wall, so it goes active when the thread view comes out; the
// thread view's right wall is the member list's wall, and the member list is
// standing furniture that is simply there, so it stays neutral.
//
// Neither colour is a warning. Operator ruling 2026-09-01, recorded in
// formant's tokens: green and orange both mean working, and orange is the one
// that says work is happening HERE. A panel somebody pulled out is exactly
// that.
//
// Pure, so the harness can load it (O-tp9).
// ---------------------------------------------------------------------------

export type DividerTone = 'neutral' | 'active'

// The panels that get PULLED OUT. The rest -- the room list, the conversation,
// the member list -- are the furniture: they are where they are, and a user who
// has not touched anything is still looking at all three.
//
// `threads` is the thread strip inside the chat column. It has no draggable
// divider today, and it is listed anyway: the set is a statement about which
// panels are transient, not a list of the grips that happen to exist, and
// leaving it out would make adding that grip later a silent behaviour change.
export const PULLED_OUT_PANELS: readonly PanelId[] = ['dock', 'threads', 'thread', 'domain']

export function isPulledOutPanel(id: PanelId): boolean {
  return PULLED_OUT_PANELS.includes(id)
}

// `owner` is the panel the divider leads -- the one rendered immediately after
// it. A divider for a panel that is not open is neutral rather than absent:
// closing a panel takes its grip away with it, and a grip still on screen for a
// panel that has gone is a drag that silently does nothing.
export function dividerTone(space: Space, owner: PanelId): DividerTone {
  const leaf = space.leaves[owner]
  if (!leaf) return 'neutral'
  return isPulledOutPanel(owner) && leaf.open ? 'active' : 'neutral'
}
