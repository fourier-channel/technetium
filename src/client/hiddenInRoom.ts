import type { MatrixClient } from 'matrix-js-sdk'
import { pictureMxcOf } from './booruRef'
import { parseMxc } from './media'

/**
 * How many pictures in this room's loaded timeline the list hides. Counted
 * from the same address the timeline hides by (pictureMxcOf, as isWithheld
 * does), so the number is the pictures that left the view.
 */
export function hiddenInRoom(client: MatrixClient | null, roomId: string | null, blocked: ReadonlySet<string>): number {
  if (!client || !roomId || blocked.size === 0) return 0
  const room = client.getRoom(roomId)
  if (!room) return 0
  let n = 0
  for (const ev of room.getLiveTimeline().getEvents()) {
    const mxc = pictureMxcOf(ev.getContent())
    const id = mxc ? parseMxc(mxc)?.mediaId : undefined
    if (id && blocked.has(id)) n++
  }
  return n
}
