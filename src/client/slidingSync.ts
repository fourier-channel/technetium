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

// Long-poll timeout for a sliding-sync request: how long the server may hold
// one open with nothing to say.
//
// 20s, from 30s (operator, 2026-09-29). A Firefox user's sync long-polls died
// mid-wait -- "CORS request did not succeed ... Status code: (null)", which in
// Firefox means the CONNECTION was cut, not a header and not our own abort
// (measured; memory firefox-cors-null-is-a-dropped-connection). Nothing on our
// side closes a request that young, and matrix.41chan.net offers HTTP/3: a
// request idle over UDP for 30s meets the common 30s home-router UDP NAT
// timeout exactly. Under it, the wait ends before the mapping does. The cost
// is one extra empty round trip per client every minute. The client's own
// deadline stays this plus the SDK's 10s buffer.
const SLIDING_SYNC_TIMEOUT_MS = 20_000

// Two explicit lists (tunables named, not inline). Native MSC4186 does NOT honor
// the proxy-era `slow_get_all_rooms`, so we cover the nav with real ranges:
//   - a SPACES list (all spaces, sorted by name) so the hierarchy is ALWAYS
//     complete -- spaces sort low by recency and otherwise fall out of a window;
//   - a ROOMS list with a generous range.
// These two lists' `required_state` stays LEAN: room chrome + own membership
// only. Member rosters have a third list of their own (ROSTERS below). Ranges are generous but
// finite; true grow-on-scroll windowing is a later optimization for
// thousands-of-rooms accounts.
const SPACES_RANGE: number[][] = [[0, 99]]
const ROOMS_RANGE: number[][] = [[0, 499]]
const LIST_REQUIRED_STATE: string[][] = [
  ['m.room.name', ''],
  ['m.room.avatar', ''],
  ['m.room.canonical_alias', ''],
  ['m.room.create', ''], // room vs space (m.space)
  ['m.room.power_levels', ''], // honorifics (~/@/+) once members load on demand
  ['m.space.child', '*'], // space hierarchy (parent -> children)
  ['m.space.parent', '*'], // child -> parent, for the parent-gate in spaces.ts
  ['m.room.member', '$ME'], // OWN membership only -- not the roster

  // ANYTHING read through room.currentState MUST be listed here. Sliding sync
  // delivers only the state types a client asks for -- unlisted state is not
  // "late", it never arrives at all, and currentState returns null forever.
  //
  // That is a silent failure with no error anywhere: the write succeeds with a
  // 200, the event exists on the server, and the client that wrote it simply
  // cannot see it. The domain background was broken this way from the day
  // sliding sync landed.
  //
  // If you add a `getStateEvents(...)` call anywhere, add its type HERE.
  ['net.41chan.domain.background', ''], // shared domain backdrop
  ['m.room.topic', ''], // room header (W3.2)
  ['m.room.pinned_events', ''], // pinned messages (W2.7)
  ['im.ponies.room_emotes', '*'], // MSC2545 emoji packs (W5.4)

  // ENCRYPTION. Its absence here was a silent plaintext leak, found 2026-09-09
  // by reading a DM's events back off the server: the room's state said
  // m.megolm.v1.aes-sha2, the creator's messages were m.room.message with a
  // readable body, and the other party's were m.room.encrypted.
  //
  // The chain is exactly the failure this comment block warns about. Sliding
  // sync never delivered m.room.encryption, so room.hasEncryptionStateEvent()
  // was false forever; roomEncryptionConfig's ensureConfigured returned early
  // every time and no outbound encryptor was ever built; and the SDK, asking
  // its own room model whether to encrypt, was told no and sent cleartext.
  // Decryption kept working the whole time, because inbound keys arrive by
  // to-device and never consult room state -- so the session looked healthy
  // from the inside while it published everything it sent.
  ['m.room.encryption', ''],

  // MEDIA TAGS. State keyed by the image's mxc, written by the bridge, read
  // through currentState by the tag store.
  //
  // Without it the store saw tags only when the write happened to fall inside
  // the loaded timeline window -- so a month-old image showed the tags it was
  // BORN with, not its current ones, and a booru retag was invisible until
  // something forced a per-image fetch. Current state is by definition the
  // latest write, so listing it here is what makes tags correct rather than
  // merely present.
  //
  // MEASURED before adding, because '*' on a per-room list is the expensive
  // shape: across this homeserver only 4 rooms carry tags at all, 462 current
  // values, about 800 KB of current state in total. (The 2.4 MB in the events
  // table is every superseded version; required_state never sends those.)
  // Re-measure before assuming this stays cheap -- the ratio of current values
  // to writes is roughly 1:3 and only the numerator is paid here.
  ['net.41chan.media.tags', '*'],

  // PINNED THREADS. One small state event per room, written by its moderators
  // (client/threadPinState.ts). Without it here every client would see no pins
  // and a moderator's pin would vanish the moment it was made.
  ['net.41chan.thread.pins', ''],
]
const TIMELINE_LIMIT = 1

// ROSTERS. Who is in each room, kept current by the server rather than polled.
//
// The SDK adds sliding sync's timeline events with addToState: false
// (sliding-sync-sdk.ts, injectRoomEvents): room state moves ONLY through
// required_state. With `m.room.member: $ME` alone above, nobody else's join or
// leave ever reached a roster -- not even in a quiet room with sync healthy
// (reproduced 2026-10-05 against Synapse 1.152.1). A once-a-minute
// /joined_members poll of every room in every tab papered over it, and was 82%
// of everything that reached the origin. Asked for here, the server sends each
// room's members once and then every change as it happens, gaps included:
// required_state deltas cover everything since the last response, however
// much timeline was skipped.
//
// Its own list, so the two above keep their lean state and this is the one
// place rosters are asked for. It is in the FIRST request: Synapse applies a
// required_state widened later only when that room next has activity
// (measured), so a list added after the first response left quiet rooms with
// no roster at all. MEASURED before adding, as tags were: 48 rooms, 42 KB of
// /joined_members in total, the largest 2.2 KB (2026-10-05) -- about 130 KB as
// member events, once per session, against 42 KB a minute per open tab for
// the poll it replaces. Spaces are included: the community list reads them.
const ROSTERS_RANGE: number[][] = [[0, 599]]
const ROSTERS_LIST: MSC3575List = {
  ranges: ROSTERS_RANGE,
  sort: ['by_recency'],
  required_state: [['m.room.member', '*']],
  timeline_limit: 0,
}

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
    ['rosters', ROSTERS_LIST],
  ])
  // Default room-subscription shape (used when a specific room is subscribed).
  const defaultRoomSub = { timeline_limit: TIMELINE_LIMIT, required_state: LIST_REQUIRED_STATE }
  return new SlidingSync(client.getHomeserverUrl(), lists, defaultRoomSub, client, SLIDING_SYNC_TIMEOUT_MS)
}
