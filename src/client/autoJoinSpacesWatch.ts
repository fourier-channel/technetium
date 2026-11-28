import { ClientEvent, RoomEvent, type MatrixClient, type Room } from 'matrix-js-sdk'
import { HUB_SPACE_ID, joinFailureText, spacesToJoin } from './autoJoinSpaces'
import { detail, reportAlways } from './report'

// Joins the person to the sub-spaces every member is in (tc.84). The decision
// is client/autoJoinSpaces.ts; this only asks it and acts.
//
// Two triggers: once when the first sync is ready (the usual case: already in
// the hub), and whenever the person's own membership of the hub becomes join
// (a newcomer accepting the hub invite mid-session). One pass at a time, so
// the two can never send the same join twice at once.
export function watchAutoJoinSpaces(client: MatrixClient): () => void {
  let running = false
  let again = false

  const membership = (roomId: string) => client.getRoom(roomId)?.getMyMembership()

  const pass = async () => {
    if (running) { again = true; return }
    running = true
    try {
      do {
        again = false
        for (const space of spacesToJoin(membership)) {
          try {
            await client.joinRoom(space.id)
          } catch (err) {
            // Seen each time: a person not in a space everyone is in is the
            // bug this exists to prevent.
            reportAlways('auto-join sub-spaces', joinFailureText(space, detail(err)))
          }
        }
      } while (again)
    } finally {
      running = false
    }
  }

  const onSync = (state: string) => {
    if (state === 'PREPARED') void pass()
  }
  const onMembership = (room: Room, m: string) => {
    if (room.roomId === HUB_SPACE_ID && m === 'join') void pass()
  }

  client.once(ClientEvent.Sync, onSync)
  client.on(RoomEvent.MyMembership, onMembership)
  return () => {
    client.off(ClientEvent.Sync, onSync)
    client.off(RoomEvent.MyMembership, onMembership)
  }
}
