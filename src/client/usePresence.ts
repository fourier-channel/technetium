import { useEffect, useState } from 'react'
import { UserEvent, type MatrixClient } from 'matrix-js-sdk'
import { presenceOf, type PresenceState } from './presence'

// ---------------------------------------------------------------------------
// W4.5 -- presence, for the rows on screen. What counts as known is decided
// in ./presence (presenceOf); this only listens and rebuilds.
//
// SERVER-GATED, and on this homeserver nothing arrives: presence is enabled,
// but Synapse's sliding sync has no presence extension (1.152.1 offers
// to_device, e2ee, account_data, receipts, typing and thread subscriptions),
// so under sliding sync no m.presence ever reaches the client. Everyone is
// unknown, and unknown is drawn as nothing.
// ---------------------------------------------------------------------------

export type PresenceMap = Map<string, PresenceState>

// Presence for the given user ids. Absent from the map = the server has told
// us nothing, which is NOT the same as offline.
export function usePresence(
  client: MatrixClient | null,
  userIds: readonly string[],
): PresenceMap {
  const [map, setMap] = useState<PresenceMap>(() => new Map())
  // Join the ids so the effect re-runs on a genuine change of membership
  // rather than on every new array identity.
  const key = userIds.join(',')

  useEffect(() => {
    if (!client) {
      queueMicrotask(() => setMap(new Map()))
      return
    }
    let cancelled = false
    const ids = key ? key.split(',') : []

    const rebuild = () => {
      if (cancelled) return
      const next: PresenceMap = new Map()
      for (const id of ids) {
        const p = presenceOf(client.getUser(id))
        if (p) next.set(id, p)
      }
      setMap(next)
    }

    queueMicrotask(rebuild)

    // Fires per user; rebuilding the whole (small) map is simpler than
    // patching one entry and cannot drift.
    const onPresence = () => rebuild()
    client.on(UserEvent.Presence, onPresence)
    return () => {
      cancelled = true
      client.off(UserEvent.Presence, onPresence)
    }
  }, [client, key])

  return map
}
