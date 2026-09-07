// What a room IS, asked of the most trustworthy thing that knows.
//
// Two sources, and they are not equal:
//
//   1. `net.41chan.class` in the room's CREATE event. Written by the server at
//      creation from what it observed, and unmodifiable for the life of the
//      room -- no client, admin, or module can change it afterwards. When this
//      is present it is the answer.
//
//   2. `m.direct`, per-user account data the CLIENT maintains. Advisory: it is
//      not self-cleaning (it keeps rooms you have left), nothing verifies that
//      a room listed in it is a two-person conversation, and nothing stops a
//      client omitting a real DM from it.
//
// Rooms created before the server started stamping have no marker at all, so
// the honest third answer is UNKNOWN. Absent must never be read as "room":
// every DM on this server predates the stamp.
import type { MatrixClient, Room } from 'matrix-js-sdk'
import { directRoomIds } from './dm'

export const CLASS_EVENT = 'm.room.create'
export const CLASS_KEY = 'net.41chan.class'

export type RoomClass = 'dm' | 'room' | 'unknown'

// The server's verdict, or null when this room predates it.
export function stampedClass(room: Room): 'dm' | 'room' | null {
  const create = room.currentState?.getStateEvents(CLASS_EVENT, '')
  const value = (create?.getContent() as Record<string, unknown> | undefined)?.[CLASS_KEY]
  return value === 'dm' || value === 'room' ? value : null
}

// The answer to use, and where it came from -- callers that render a
// consequential decision should be able to say which source spoke.
export function classifyRoom(client: MatrixClient, room: Room): {
  klass: RoomClass
  source: 'create-event' | 'm.direct' | 'none'
} {
  const stamped = stampedClass(room)
  if (stamped) return { klass: stamped, source: 'create-event' }
  // Fall back, but only to say DM -- absence from m.direct proves nothing,
  // because the map is not a complete record of anything.
  if (directRoomIds(client).has(room.roomId)) return { klass: 'dm', source: 'm.direct' }
  return { klass: 'unknown', source: 'none' }
}

// The question the room list actually asks. Kept separate from classifyRoom so
// the "unknown means not-a-DM for display purposes" decision lives in ONE place
// rather than being re-made at each call site.
export function isDirect(client: MatrixClient, room: Room): boolean {
  return classifyRoom(client, room).klass === 'dm'
}
