import { EventType, Preset, Visibility, type MatrixClient } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// W3.8 -- direct messages.
//
// `m.direct` is ACCOUNT DATA mapping user id -> room ids. It is the only thing
// that makes a room "a DM", so creating one without updating it produces a
// room that behaves like a DM nowhere else, including in Element.
//
// Detection comes first, deliberately: opening a second DM with someone you
// already have one with is the most common way this feature goes wrong, and
// the room list then shows two identical entries with the history split
// between them.
// ---------------------------------------------------------------------------

type DirectMap = Record<string, string[]>

export function readDirectMap(client: MatrixClient): DirectMap {
  const ev = client.getAccountData(EventType.Direct)
  const content = ev?.getContent()
  if (!content || typeof content !== 'object') return {}
  const out: DirectMap = {}
  for (const [userId, rooms] of Object.entries(content)) {
    if (Array.isArray(rooms)) out[userId] = rooms.filter((r): r is string => typeof r === 'string')
  }
  return out
}

// An existing, still-joined DM with this user, or null.
//
// The m.direct map is not self-cleaning: it keeps rooms the user has left, so
// a hit has to be verified against actual membership or we would "reuse" a
// room nobody is in.
export function findExistingDm(client: MatrixClient, userId: string): string | null {
  const map = readDirectMap(client)
  for (const roomId of map[userId] ?? []) {
    const room = client.getRoom(roomId)
    if (room?.getMyMembership() === 'join') return roomId
  }
  return null
}

async function addToDirectMap(
  client: MatrixClient,
  userId: string,
  roomId: string,
): Promise<void> {
  const map = readDirectMap(client)
  const existing = map[userId] ?? []
  if (existing.includes(roomId)) return
  await client.setAccountData(EventType.Direct, { ...map, [userId]: [...existing, roomId] })
}

export interface StartDmResult {
  roomId: string
  // True when an existing DM was reused rather than a new room created.
  existing: boolean
}

export async function startDm(client: MatrixClient, userId: string): Promise<StartDmResult> {
  const existing = findExistingDm(client, userId)
  if (existing) return { roomId: existing, existing: true }

  const { room_id: roomId } = await client.createRoom({
    is_direct: true,
    // trusted_private_chat gives the invitee the same power level as the
    // creator, which is what a two-person conversation should be -- neither
    // party is moderating the other.
    preset: Preset.TrustedPrivateChat,
    visibility: Visibility.Private,
    invite: [userId],
  })

  // Written AFTER creation and awaited: if this fails the room exists but is
  // not a DM anywhere, which the caller needs to be able to say.
  await addToDirectMap(client, userId, roomId)
  return { roomId, existing: false }
}
