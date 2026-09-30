import type { MatrixClient, Room } from 'matrix-js-sdk'
import type { MergedMember } from '../client/members'
import type { PresenceState } from '../client/usePresence'
import { ProfileActions } from './ProfileActions'
import { ProfileCard } from './ProfileCard'

// The profile preview, as every panel that draws people hosts it (L23): the
// card, and what can be done from it. The timeline, the thread panel and the
// member list each wired these two together by hand; three copies of one
// pairing is how one of them stops offering Message (D-tc01).
export interface PersonCardTarget {
  userId: string
  x: number
  y: number
}

export function PersonCard({
  client,
  target,
  room,
  presence,
  member,
  onOpenRoom,
  onClose,
}: {
  client: MatrixClient
  target: PersonCardTarget
  room: Room | null
  presence?: PresenceState
  member?: MergedMember
  onOpenRoom?: (roomId: string) => void
  onClose: () => void
}) {
  return (
    <ProfileCard
      x={target.x}
      y={target.y}
      userId={target.userId}
      room={room}
      member={member}
      presence={presence}
      actions={
        <ProfileActions client={client} userId={target.userId} room={room} onOpenRoom={onOpenRoom} onClose={onClose} />
      }
      onClose={onClose}
    />
  )
}
