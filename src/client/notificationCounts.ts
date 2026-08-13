// ---------------------------------------------------------------------------
// Notification counts -- the pure half.
//
// G-tp23: Simplified Sliding Sync (MSC4186) does NOT deliver notification
// counts. Synapse sends `notification_count: 0` and `highlight_count: 0` for
// every room, always. It SENDS the field, so the sdk's `!= null` guard passes
// and `setUnreadNotificationCount()` is called with a real zero -- nothing
// errors, nothing warns, and `room.getUnreadNotificationCount()` has therefore
// returned 0 for every room since sliding sync landed on 2026-07-19. The
// room-list glow, the (N) count, the ping treatment and the space rollup have
// all been faithfully rendering a permanent zero.
//
// Synapse itself has the numbers -- only the MSC4186 path withholds them. Same
// account, same room, same minute: classic /sync reported room `chat` at
// notification_count 5 while the sliding-sync path set it to 0. So the counts
// come from a classic /sync instead (see useRoomNotifications for the request).
//
// This module is deliberately free of VALUE imports so the check harness can
// load it (O-tp9: a module under check imports matrix-js-sdk TYPES only).
// ---------------------------------------------------------------------------

export interface NotifCounts {
  total: number
  highlight: number
}
export type NotifMap = Map<string, NotifCounts>

// The filter PROVEN against the live homeserver on 2026-08-13.
//
// Not trimmed further on purpose. `timeline.limit: 0` and account_data
// exclusions would very likely also work and would shrink the response, but
// they are an unverified change to the one request shape known to return the
// counts, and this box cannot verify it. If someone tightens this, it needs a
// live re-check, not a reading of the spec.
export const COUNTS_FILTER = JSON.stringify({
  presence: { types: [] },
  room: {
    timeline: { limit: 1 },
    state: { types: [] },
    ephemeral: { types: [] },
  },
})

// Structural shape of the only part of a /sync response this reads.
interface CountsSyncResponse {
  rooms?: {
    join?: Record<
      string,
      { unread_notifications?: { notification_count?: unknown; highlight_count?: unknown } }
    >
  }
}

// Rooms with a non-zero count, keyed by room id.
//
// Only non-zero entries are stored, matching what the sdk-backed path produced
// before this existed: consumers treat "absent" and "zero" identically, and
// carrying 40 zero entries would make every comparison and re-render pointless
// work.
export function parseNotificationCounts(res: unknown): NotifMap {
  const out: NotifMap = new Map()
  const join = (res as CountsSyncResponse | null)?.rooms?.join
  if (!join || typeof join !== 'object') return out
  for (const [roomId, data] of Object.entries(join)) {
    const un = data?.unread_notifications
    // Server-supplied: a non-number (or a negative) is treated as absent
    // rather than coerced, so a malformed response reads as "no unread"
    // instead of NaN propagating into the badge.
    const rawTotal = un?.notification_count
    const rawHigh = un?.highlight_count
    const total = typeof rawTotal === 'number' && rawTotal > 0 ? Math.floor(rawTotal) : 0
    const highlight = typeof rawHigh === 'number' && rawHigh > 0 ? Math.floor(rawHigh) : 0
    if (total > 0 || highlight > 0) out.set(roomId, { total, highlight })
  }
  return out
}

// --- poll scheduling ---------------------------------------------------------
//
// How long after the FIRST event of a burst to poll, and the floor between two
// activity-driven polls.
export const POLL_SETTLE_MS = 1_500
export const MIN_POLL_GAP_MS = 5_000

// When should the next activity-driven poll run? null = one is already armed,
// so do nothing.
//
// NON-STARVABLE BY CONSTRUCTION, and that is the whole point. `ClientEvent.Sync`
// fires on EVERY sliding-sync long-poll cycle -- several times a second while a
// room is busy. A debounce that cleared and re-armed on each event never fired
// at all: the burst that most needs a refresh is precisely the burst that keeps
// postponing it, so counts only updated once traffic went quiet. Here the first
// event of a burst arms a deadline and every later event is ignored until it
// lands, which bounds the wait at POLL_SETTLE_MS no matter how loud the room is.
//
// The gap floor is the other half: with the starvation gone, a busy room would
// otherwise poll every 1.5s, and each poll is a full (if filtered) sync.
export function nextPollDelay(now: number, lastPollAt: number, scheduled: boolean): number | null {
  if (scheduled) return null
  const since = now - lastPollAt
  return Math.max(POLL_SETTLE_MS, MIN_POLL_GAP_MS - since)
}

// Value equality. The poll returns a fresh Map every time; swapping an equal
// one into state would re-render the whole nav tree on every tick for nothing.
export function sameCounts(a: NotifMap, b: NotifMap): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const [roomId, counts] of a) {
    const other = b.get(roomId)
    if (!other || other.total !== counts.total || other.highlight !== counts.highlight) return false
  }
  return true
}
