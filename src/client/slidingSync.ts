import { SlidingSync, type MSC3575List } from 'matrix-js-sdk/lib/sliding-sync'
import type { MatrixClient } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// Native Simplified Sliding Sync (MSC4186) wiring, ISOLATED here on purpose.
//
// !!! FRAGILE DEPENDENCY (operator-approved deviation, 2026-07-18) !!!
// matrix-js-sdk 41.6.0 does NOT export the `SlidingSync` class from its public
// entry -- only `SlidingSyncEvent`. So we deep-import the INTERNAL path
// `matrix-js-sdk/lib/sliding-sync`, which is unsupported surface: a future SDK
// bump can move/rename/retype it without notice. Everything that touches that
// internal path lives in THIS ONE FILE so a break is a single-file fix.
//
// STANDING RULE: before recommending ANY matrix-js-sdk upgrade, scan the target
// version for sliding-sync changes (is `SlidingSync` public yet? did the class
// signature / list config shape / endpoint change?) and re-verify this module
// against it. Do not bump the SDK blind. See CLIENT_MANIFEST.md.
//
// Server: matrix.41chan.net advertises `org.matrix.simplified_msc3575` and the
// native endpoint answers (no proxy). Passing the homeserver's own base URL as
// the SlidingSync "proxyBaseUrl" makes the SDK target that native endpoint.
// ---------------------------------------------------------------------------

// Opt-in via env so the default classic-sync path is untouched until this is
// proven against a live login. Set VITE_SLIDING_SYNC=1 to enable.
export function slidingSyncEnabled(): boolean {
  return !!import.meta.env.VITE_SLIDING_SYNC
}

// Long-poll timeout for a sliding-sync request.
const SLIDING_SYNC_TIMEOUT_MS = 30_000

// Two explicit lists (tunables named, not inline). Native MSC4186 does NOT honor
// the proxy-era `slow_get_all_rooms`, so we cover the nav with real ranges:
//   - a SPACES list (all spaces, sorted by name) so the hierarchy is ALWAYS
//     complete -- spaces sort low by recency and otherwise fall out of a window;
//   - a ROOMS list with a generous range.
// `required_state` stays LEAN everywhere: room chrome + own membership only,
// NEVER the full member rosters that made classic sync heavy. Per-user members
// load on demand (CD-15). Ranges are generous but finite; true grow-on-scroll
// windowing is a later optimization for thousands-of-rooms accounts.
const SPACES_RANGE: number[][] = [[0, 99]]
const ROOMS_RANGE: number[][] = [[0, 499]]
const LIST_REQUIRED_STATE: string[][] = [
  ['m.room.name', ''],
  ['m.room.avatar', ''],
  ['m.room.canonical_alias', ''],
  ['m.room.create', ''], // room vs space (m.space)
  ['m.space.child', '*'], // space hierarchy (parent -> children)
  ['m.space.parent', '*'], // child -> parent, for the parent-gate in spaces.ts
  ['m.room.member', '$ME'], // OWN membership only -- not the roster
]
const TIMELINE_LIMIT = 1

// Build a SlidingSync instance for the client. The caller passes it to
// startClient({ slidingSync }); the SDK's SlidingSyncSdk then drives it (we do
// NOT call start() ourselves).
export function buildSlidingSync(client: MatrixClient): SlidingSync {
  const lists = new Map<string, MSC3575List>([
    [
      // All spaces, so the nav hierarchy is always complete regardless of activity.
      'spaces',
      {
        ranges: SPACES_RANGE,
        sort: ['by_name'],
        filters: { room_types: ['m.space'] },
        required_state: LIST_REQUIRED_STATE,
        timeline_limit: 0,
      },
    ],
    [
      // Non-space rooms, generous range, most-recent first.
      'rooms',
      {
        ranges: ROOMS_RANGE,
        sort: ['by_recency'],
        filters: { not_room_types: ['m.space'] },
        required_state: LIST_REQUIRED_STATE,
        timeline_limit: TIMELINE_LIMIT,
      },
    ],
  ])
  // Default room-subscription shape (used when a specific room is subscribed).
  const defaultRoomSub = { timeline_limit: TIMELINE_LIMIT, required_state: LIST_REQUIRED_STATE }
  return new SlidingSync(client.getHomeserverUrl(), lists, defaultRoomSub, client, SLIDING_SYNC_TIMEOUT_MS)
}
