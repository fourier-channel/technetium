import { useCallback, useSyncExternalStore } from 'react'
import { RoomMemberEvent, RoomStateEvent } from 'matrix-js-sdk'
import { useClient } from '../client/clientContextValue'
import { highestLevelElsewhere } from '../client/members'

// One person's highest power level in the space rooms other than this one,
// live: it re-reads when any power level or room state changes, so a + given
// or taken in another room shows on the next event rather than on the next
// remount. The snapshot is a number, so a row redraws only when that number
// moves (members.ts highestLevelElsewhere says which rooms count).
export function useLevelElsewhere(userId: string, roomId: string): number {
  const { client } = useClient()
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!client) return () => {}
      client.on(RoomMemberEvent.PowerLevel, onChange)
      client.on(RoomStateEvent.Events, onChange)
      return () => {
        client.off(RoomMemberEvent.PowerLevel, onChange)
        client.off(RoomStateEvent.Events, onChange)
      }
    },
    [client],
  )
  const snapshot = useCallback(
    () => (client ? highestLevelElsewhere(client, userId, roomId) : 0),
    [client, userId, roomId],
  )
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
