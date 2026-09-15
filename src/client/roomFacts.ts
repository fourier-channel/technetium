import type { MatrixClient, Room } from 'matrix-js-sdk'
import { requiredToSetPower } from './powerLevels'
import { isDirect } from './roomClass'
import type { RoomFacts, RoomUser } from './serverPermissions'

// ---------------------------------------------------------------------------
// Reading the server's shape out of the client store (ui-depth-v1 U8).
//
// The audit itself is pure and lives in serverPermissions.ts; this is the only
// piece that touches the SDK, and it is deliberately dumb -- it reads state and
// hands over plain data, with no opinion about any of it. Keeping the two apart
// is what lets every rule in the audit be checked without a homeserver.
//
// EVERYTHING HERE IS ALREADY SYNCED. No request is made: these are the same
// state events the room list, the member list and the timeline are drawn from.
// A room the client has not loaded state for reports what it knows, which is
// the honest answer and is why the panel shows the member count it is working
// from rather than implying completeness.
// ---------------------------------------------------------------------------

function stateString(room: Room, type: string, key: string): string | null {
  const ev = room.currentState.getStateEvents(type, '')
  if (!ev) return null
  const v = (ev.getContent() as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : null
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

// The spaces this room says it belongs to.
//
// Read from the PARENT's m.space.child rather than the child's m.space.parent,
// because m.space.parent is the weaker of the two: any room may claim any
// parent, and the claim is only canonical if the parent agrees. The child list
// is the one the space itself wrote.
function parentsOf(client: MatrixClient, roomId: string): string[] {
  const out: string[] = []
  for (const r of client.getRooms()) {
    if (!r.isSpaceRoom()) continue
    for (const ev of r.currentState.getStateEvents('m.space.child')) {
      // An m.space.child with empty content is a REMOVED child, not a child.
      if (Object.keys(ev.getContent()).length === 0) continue
      if (ev.getStateKey() === roomId) out.push(r.roomId)
    }
  }
  return out
}

export function readRoomFacts(client: MatrixClient): RoomFacts[] {
  const rooms = client.getRooms().filter((r) => r.getMyMembership() === 'join')
  return rooms.map((room) => {
    const pl = room.currentState.getStateEvents('m.room.power_levels', '')
    const content = (pl?.getContent() ?? {}) as Record<string, unknown>
    const users: RoomUser[] = []
    const rawUsers = content.users
    if (rawUsers && typeof rawUsers === 'object') {
      for (const [userId, level] of Object.entries(rawUsers as Record<string, unknown>)) {
        if (typeof level === 'number' && Number.isFinite(level)) users.push({ userId, level })
      }
    }
    return {
      roomId: room.roomId,
      name: room.name || room.roomId,
      isSpace: room.isSpaceRoom(),
      isDm: isDirect(client, room),
      parentIds: parentsOf(client, room.roomId),
      joinRule: stateString(room, 'm.room.join_rules', 'join_rule'),
      historyVisibility: stateString(room, 'm.room.history_visibility', 'history_visibility'),
      guestAccess: stateString(room, 'm.room.guest_access', 'guest_access'),
      encrypted: !!room.currentState.getStateEvents('m.room.encryption', ''),
      memberCount: room.getJoinedMemberCount(),
      // The spec's own defaults, each one used only when the room says nothing.
      usersDefault: num(content.users_default, 0),
      eventsDefault: num(content.events_default, 0),
      stateDefault: num(content.state_default, 50),
      invite: num(content.invite, 0),
      kick: num(content.kick, 50),
      ban: num(content.ban, 50),
      redact: num(content.redact, 50),
      powerLevelsRequired: requiredToSetPower(content),
      users,
    }
  })
}
