import type { MatrixClient, Room } from 'matrix-js-sdk'
import type { TreeNode } from './spaces'
import { markRoomRead } from './receipts'

// ---------------------------------------------------------------------------
// W3.1 -- "Mark as read", for one room or a whole space.
//
// Uses the S4 helper, so a menu-driven receipt lands on exactly the same event
// the auto-marker would pick. Two implementations of "which event counts as
// read" would drift, and the drift shows up as rooms that will not clear --
// the complaint this feature exists to answer.
// ---------------------------------------------------------------------------

// Hard ceiling on how many rooms one click will receipt. A space with hundreds
// of descendants should not fire hundreds of requests because someone right
// -clicked it; better to clear what we can and report the shortfall.
const MAX_ROOMS = 200

export interface MarkReadResult {
  attempted: number
  cleared: number
  failed: number
  // True when the space had more descendants than MAX_ROOMS, so the caller can
  // say so instead of silently doing part of the job.
  truncated: boolean
}

// Flatten a nav node to the joined, non-space rooms under it (itself included
// when it is a room). Depth-first, de-duplicated: a room can appear under more
// than one space.
export function collectJoinedRooms(node: TreeNode): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const walk = (n: TreeNode) => {
    if (!n.isSpace && n.membership === 'join' && !seen.has(n.roomId)) {
      seen.add(n.roomId)
      out.push(n.roomId)
    }
    for (const child of n.children) walk(child)
  }
  walk(node)
  return out
}

// Receipt every room under `node`, SEQUENTIALLY.
//
// Sequential rather than parallel on purpose: this is a convenience action, not
// something anyone is waiting on, and firing 50 concurrent requests at the
// homeserver to save a second of wall clock is a poor trade -- especially since
// each one is a write.
export async function markNodeRead(
  client: MatrixClient,
  node: TreeNode,
): Promise<MarkReadResult> {
  const all = collectJoinedRooms(node)
  const roomIds = all.slice(0, MAX_ROOMS)
  let cleared = 0
  let failed = 0

  for (const roomId of roomIds) {
    const room: Room | null = client.getRoom(roomId)
    if (!room) {
      failed++
      continue
    }
    try {
      const result = await markRoomRead(client, room)
      if (result.sentFor) cleared++
    } catch (err) {
      failed++
      console.error(`Mark-as-read failed for ${roomId}:`, err)
    }
  }

  return {
    attempted: roomIds.length,
    cleared,
    failed,
    truncated: all.length > roomIds.length,
  }
}
