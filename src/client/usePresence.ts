import { useEffect, useState } from 'react'
import { UserEvent, type MatrixClient } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// W4.5 -- presence.
//
// SERVER-GATED. Synapse ships with `presence.enabled: false` on many
// deployments because it is expensive, and when it is off the server simply
// never sends m.presence. There is then no such thing as "offline" -- only
// "unknown".
//
// So this returns undefined for a user we have heard nothing about, and the
// renderer draws NOTHING. Rendering a grey dot for unknown would tell every
// member of the room that everyone is offline, which is a lie the client
// invented rather than something the server said.
// ---------------------------------------------------------------------------

export type PresenceState = 'online' | 'unavailable' | 'offline'

export type PresenceMap = Map<string, PresenceState>

function read(client: MatrixClient, userId: string): PresenceState | undefined {
  const user = client.getUser(userId)
  const p = user?.presence
  if (p === 'online' || p === 'unavailable' || p === 'offline') return p
  return undefined
}

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
        const p = read(client, id)
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

export function presenceLabel(state: PresenceState | undefined): string | null {
  if (state === 'online') return 'Online'
  if (state === 'unavailable') return 'Away'
  if (state === 'offline') return 'Offline'
  // Deliberately null: unknown is not a status to display.
  return null
}
