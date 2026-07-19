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

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      client.off(ClientEvent.Room, onRoom)
    }
  }, [client])
}
