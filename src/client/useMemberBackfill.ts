import { useEffect } from 'react'
import { ClientEvent, type MatrixClient } from 'matrix-js-sdk'
import { slidingSyncEnabled } from './slidingSync'

// ---------------------------------------------------------------------------
// Background member hydration (sliding sync only).
//
// Under sliding sync each room's required_state carries only $ME, so a room's
// full roster is absent until asked for. Opening a room hydrates that ONE (see
// MemberList). This backfills the REST in the background so the aggregate member
// list (All / Nearby) fills to the whole community -- throttled so we do not
// fire every /members at once. loadMembersIfNeeded is idempotent (no-ops once a
// room is loaded), so re-runs are cheap. Classic sync already ships rosters, so
// this does nothing there.
// ---------------------------------------------------------------------------

const CONCURRENCY = 4 // /members fetches in flight at once
const RESCAN_DEBOUNCE_MS = 1000 // coalesce bursts of late-arriving rooms

export function useMemberBackfill(client: MatrixClient | null): void {
  useEffect(() => {
    if (!client || !slidingSyncEnabled()) return
    let cancelled = false

    const hydrate = async () => {
      const rooms = client
        .getRooms()
        .filter((r) => r.getMyMembership() === 'join' && !r.isSpaceRoom())
      for (let i = 0; i < rooms.length && !cancelled; i += CONCURRENCY) {
        await Promise.all(
          rooms.slice(i, i + CONCURRENCY).map((r) => r.loadMembersIfNeeded().catch(() => undefined)),
        )
      }
    }

    void hydrate()

    // Rooms stream in over time under sliding sync; re-run (debounced) so late
    // arrivals get hydrated too. Idempotent, so already-loaded rooms cost nothing.
    let timer: ReturnType<typeof setTimeout> | null = null
    const onRoom = () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        void hydrate()
      }, RESCAN_DEBOUNCE_MS)
    }
    client.on(ClientEvent.Room, onRoom)

    // The roster is a snapshot: loadMembersIfNeeded never asks again, and a
    // room outside the sliding window sends no member events, so a join that
    // happened after the first load was invisible until reload ("load once at
    // start and never update", operator 2026-09-06). Re-hydrate on a slow
    // cadence and whenever the window regains focus: clear the loaded flag,
    // ask again. Throttled like the initial pass.
    const REHYDRATE_MS = 60_000
    let rehydrating = false
    const rehydrate = async () => {
      if (rehydrating) return
      rehydrating = true
      try {
        const rooms = client.getRooms().filter((r) => r.getMyMembership() === 'join')
        for (let i = 0; i < rooms.length; i += CONCURRENCY) {
          await Promise.all(
            rooms.slice(i, i + CONCURRENCY).map(async (r) => {
              // Ask the server who is joined and compare with what the room
              // knows. Only a room whose roster actually differs is cleared
              // and reloaded: clearing first made every refresh drop the
              // whole roster and pop it back in, so the list blinked every
              // minute (operator, 2026-09-06).
              try {
                const { joined } = await client.getJoinedRoomMembers(r.roomId)
                const server = new Set(Object.keys(joined ?? {}))
                const known = new Set(r.getJoinedMembers().map((m) => m.userId))
                const same = server.size === known.size && [...server].every((u) => known.has(u))
                if (same) return
                await r.clearLoadedMembersIfNeeded()
                await r.loadMembersIfNeeded()
              } catch {
                /* transient; the next pass retries */
              }
            }),
          )
        }
      } finally {
        rehydrating = false
      }
    }
    const interval = setInterval(() => void rehydrate(), REHYDRATE_MS)
    const onFocus = () => void rehydrate()
    window.addEventListener('focus', onFocus)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      client.off(ClientEvent.Room, onRoom)
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [client])
}
