// ---------------------------------------------------------------------------
// System noise: events that exist so the room works, not so anybody reads them.
//
// These reach the renderer, match no case, and come out as the literal string
// `[m.room.server_acl]` or `[net.41chan.domain.action]` -- a row that costs
// height, breaks a sender cluster in two, and tells the reader nothing. They
// are hidden by default and revealed by a preference, because "hidden" and
// "does not exist" are different claims and only one of them is true.
//
// Two rules rather than one list, because they fail differently:
//
//   - `net.41chan.*` is ours, and every one of them is app state -- canvas
//     positions, backgrounds, interactions, actions. A prefix rule covers the
//     ones not yet written, which a list cannot.
//   - `m.room.*` config is a fixed, known set. A prefix rule there would be
//     wrong: m.room.message and m.room.member are the whole point of the
//     client, so this one is enumerated on purpose.
//
// Anything unrecognised stays VISIBLE. Hiding by default whatever we failed to
// classify is how a real event disappears and nobody finds out for a month.
//
// Pure, so the harness can load it (O-tp9).
// ---------------------------------------------------------------------------

const OUR_PREFIX = 'net.41chan.'

// Room configuration. Real state changes, but nothing here has a renderer, and
// several fire in bursts when a room is created.
const ROOM_CONFIG = new Set([
  'm.room.server_acl',
  'm.room.power_levels',
  'm.room.join_rules',
  'm.room.history_visibility',
  'm.room.guest_access',
  'm.room.canonical_alias',
  'm.room.related_groups',
  'm.room.encryption',
  'm.room.pinned_events',
  'm.room.tombstone',
  'm.room.create',
  'm.space.child',
  'm.space.parent',
])

export function isSystemEvent(eventType: string): boolean {
  return eventType.startsWith(OUR_PREFIX) || ROOM_CONFIG.has(eventType)
}
