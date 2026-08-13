import { useEffect, useState } from 'react'
import {
  ClientEvent,
  ClientPrefix,
  Method,
  NotificationCountType,
  RoomEvent,
  type MatrixClient,
} from 'matrix-js-sdk'
import {
  COUNTS_FILTER,
  nextPollDelay,
  parseNotificationCounts,
  sameCounts,
  type NotifCounts,
  type NotifMap,
} from './notificationCounts'
import { slidingSyncEnabled } from './slidingSync'
import { reportAlways } from './report'

// ---------------------------------------------------------------------------
// Live per-room notification counts. Returns a Map roomId -> {total, highlight}
// for joined rooms. The nav tree reads this for the unread glow / (count) /
// ping treatment, and aggregates it up to collapsed space headers.
//
// TWO SOURCES, chosen by sync mode -- see G-tp23 in notificationCounts.ts:
//
//   classic sync  -- the sdk's own per-room counts are correct and free, so
//                    they are read straight off the Room, event-driven.
//   sliding sync  -- the sdk's counts are a PERMANENT ZERO, because MSC4186
//                    never sends real ones. The numbers come from a stateless
//                    classic /sync instead.
//
// The counts are held HERE rather than written back into each Room. Writing
// them into Room state would fight sliding sync, which re-zeroes every room it
// touches: the number would flicker between correct and 0 on every sync.
//
// State is only ever updated from callbacks or a timer, never synchronously in
// an effect body (React Compiler set-state-in-effect discipline, G-tc01).
// ---------------------------------------------------------------------------

export type { NotifCounts, NotifMap }

const EMPTY_COUNTS: NotifMap = new Map()

// Backstop cadence: catches anything the events did not announce. The
// activity-driven timing lives in nextPollDelay (notificationCounts.ts).
const POLL_INTERVAL_MS = 30_000

// Classic-sync path: read what the sdk already has.
function computeFromSdk(client: MatrixClient): NotifMap {
  const m: NotifMap = new Map()
  for (const room of client.getRooms()) {
    if (room.getMyMembership() !== 'join') continue
    const total = room.getUnreadNotificationCount(NotificationCountType.Total)
    const highlight = room.getUnreadNotificationCount(NotificationCountType.Highlight)
    if (total > 0 || highlight > 0) m.set(room.roomId, { total, highlight })
  }
  return m
}

// One filtered, STATELESS classic /sync, read for its unread_notifications.
//
// Stateless is a REQUIREMENT, not a simplification: this must never send a
// `since` token. An incremental classic sync ACKS the to-device queue, which
// would consume to-device messages the sliding-sync stream has not seen. That
// costs nothing today (content rooms are unencrypted by design) but would
// silently break the deferred DM/mod-room encryption phase -- and it would
// break it in the least visible way possible, which is exactly the failure
// class D-tp16 exists to prevent. A fresh request every time acks nothing.
async function fetchNotificationCounts(client: MatrixClient): Promise<NotifMap> {
  const res = await client.http.authedRequest<unknown>(
    Method.Get,
    '/sync',
    { filter: COUNTS_FILTER, timeout: '0' },
    undefined,
    { prefix: ClientPrefix.V3 },
  )
  return parseNotificationCounts(res)
}

// Inert when `client` is null, so the caller can select between the two
// sources without calling a hook conditionally.
function useSdkNotifications(client: MatrixClient | null): NotifMap {
  const [map, setMap] = useState<NotifMap>(EMPTY_COUNTS)

  useEffect(() => {
    if (!client) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const next = computeFromSdk(client)
        setMap((prev) => (sameCounts(prev, next) ? prev : next))
      }, 200)
    }
    // Deferred through the timer, so it is not a synchronous setState.
    schedule()

    // Room-level events the client re-emits; the sdk's EmittedEvents union
    // doesn't enumerate them, so cast the names (runtime is correct).
    type ClientEv = Parameters<typeof client.on>[0]
    const RE_TIMELINE = RoomEvent.Timeline as unknown as ClientEv
    const RE_RECEIPT = RoomEvent.Receipt as unknown as ClientEv
    const RE_UNREAD = RoomEvent.UnreadNotifications as unknown as ClientEv

    client.on(ClientEvent.Sync, schedule)
    client.on(ClientEvent.Room, schedule)
    client.on(RE_TIMELINE, schedule)
    client.on(RE_RECEIPT, schedule)
    client.on(RE_UNREAD, schedule)
    return () => {
      if (timer) clearTimeout(timer)
      client.off(ClientEvent.Sync, schedule)
      client.off(ClientEvent.Room, schedule)
      client.off(RE_TIMELINE, schedule)
      client.off(RE_RECEIPT, schedule)
      client.off(RE_UNREAD, schedule)
    }
  }, [client])

  return map
}

// Sliding-sync path (G-tp23). Inert when `client` is null.
function usePolledNotifications(client: MatrixClient | null): NotifMap {
  const [map, setMap] = useState<NotifMap>(EMPTY_COUNTS)

  useEffect(() => {
    if (!client) return
    // Captured after the guard: refresh/soon are function DECLARATIONS so they
    // hoist, which puts them outside the narrowing the guard performed.
    const mx = client
    let cancelled = false
    let inFlight = false
    let settle: ReturnType<typeof setTimeout> | undefined
    let lastPollAt = 0

    async function refresh() {
      if (cancelled) return
      // Already asking. RE-ARM rather than drop this one: a dropped refresh is
      // a stale count until the next event or the 30s backstop, which is the
      // "only updates sporadically" symptom. The gap floor in nextPollDelay
      // stops the re-arm becoming a spin, since lastPollAt was just stamped.
      if (inFlight) {
        soon()
        return
      }
      // A hidden tab would spend a request on a room list nobody can see. NOT
      // re-armed: the visibilitychange listener below asks on the way back,
      // and a timer chain against a hidden tab would run until it returned.
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      inFlight = true
      lastPollAt = Date.now()
      try {
        const next = await fetchNotificationCounts(mx)
        if (!cancelled) setMap((prev) => (sameCounts(prev, next) ? prev : next))
      } catch (err) {
        // The room list silently showing no unread is precisely the state
        // this whole exercise was spent diagnosing. If it comes back, it says
        // so this time.
        reportAlways('notification counts: classic /sync poll', err)
      } finally {
        inFlight = false
      }
    }

    // Activity -> ask once things settle, so a new message shows its count in
    // about a second rather than at the next backstop tick.
    //
    // The scheduling rule is nextPollDelay's, and it is deliberately NOT a
    // debounce: ClientEvent.Sync fires on every sliding-sync long-poll cycle,
    // so re-arming per event meant the timer never landed while a room was
    // busy. See the note at nextPollDelay.
    // Declared as a function so it and refresh can call each other without an
    // ordering dance -- refresh re-arms through here when a poll is in flight.
    function soon() {
      const delay = nextPollDelay(Date.now(), lastPollAt, settle !== undefined)
      if (delay === null) return
      settle = setTimeout(() => {
        settle = undefined
        void refresh()
      }, delay)
    }

    // First fetch is deferred (0ms) rather than awaited inline, keeping the
    // effect body free of a synchronous setState.
    const first = setTimeout(() => void refresh(), 0)
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS)

    type ClientEv = Parameters<typeof client.on>[0]
    const RE_TIMELINE = RoomEvent.Timeline as unknown as ClientEv
    const RE_RECEIPT = RoomEvent.Receipt as unknown as ClientEv

    client.on(ClientEvent.Sync, soon)
    client.on(RE_TIMELINE, soon)
    client.on(RE_RECEIPT, soon)

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      clearTimeout(first)
      clearInterval(interval)
      if (settle) clearTimeout(settle)
      client.off(ClientEvent.Sync, soon)
      client.off(RE_TIMELINE, soon)
      client.off(RE_RECEIPT, soon)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [client])

  return map
}

export function useRoomNotifications(client: MatrixClient | null): NotifMap {
  // Both hooks are always called; the one that is not in use is handed a null
  // client and does nothing.
  const sliding = slidingSyncEnabled()
  const polled = usePolledNotifications(sliding ? client : null)
  const fromSdk = useSdkNotifications(sliding ? null : client)
  return sliding ? polled : fromSdk
}
