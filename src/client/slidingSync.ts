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

// The room-list window + what state each room ships with. Tunables kept here as
// named values, not inline literals, so the window/sort/state are one edit.
const INITIAL_RANGE: number[][] = [[0, 20]]
const LIST_SORT = ['by_recency']
const LIST_REQUIRED_STATE: string[][] = [
  ['m.room.name', ''],
  ['m.room.avatar', ''],
  ['m.room.canonical_alias', ''],
  ['m.room.create', ''],
  ['m.space.child', '*'],
]
const TIMELINE_LIMIT = 1

// Build a SlidingSync instance for the client. The caller passes it to
// startClient({ slidingSync }); the SDK's SlidingSyncSdk then drives it (we do
// NOT call start() ourselves).
export function buildSlidingSync(client: MatrixClient): SlidingSync {
  const lists = new Map<string, MSC3575List>([
    [
      'rooms',
      {
        ranges: INITIAL_RANGE,
        sort: LIST_SORT,
        required_state: LIST_REQUIRED_STATE,
        timeline_limit: TIMELINE_LIMIT,
      },
    ],
  ])
  // Default room-subscription shape (used when a specific room is subscribed).
  const defaultRoomSub = { timeline_limit: TIMELINE_LIMIT, required_state: LIST_REQUIRED_STATE }
  return new SlidingSync(client.getHomeserverUrl(), lists, defaultRoomSub, client, SLIDING_SYNC_TIMEOUT_MS)
}
