import { EventType, Preset, Visibility, type MatrixClient } from 'matrix-js-sdk'
import { decideDmEncryption, willEncrypt, type DmEncryptionDecision } from './dmEncryption'

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

// Every room id the m.direct map claims, as a set.
//
// Membership is deliberately NOT verified here -- findExistingDm does that,
// because REUSING a room the user has left would be wrong. This is only used to
// decide how a room is PRESENTED (a DM is drawn as the person on the other end,
// not as a room), where a stale entry costs nothing.
export function directRoomIds(client: MatrixClient): Set<string> {
  const out = new Set<string>()
  for (const rooms of Object.values(readDirectMap(client))) {
    for (const roomId of rooms) out.add(roomId)
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

// A DM is only a DM for whoever has it in their m.direct. The creator writes
// their side in startDm; the ACCEPTOR has only the invite event's is_direct
// flag to go on, read here BEFORE joining (after the join, our member event
// is the join and the flag lives in prev_content at best). Returns the
// inviter -- the person the conversation is with -- or null when the pending
// invite is not a DM invite.
export function pendingDmInviter(client: MatrixClient, roomId: string): string | null {
  const myId = client.getUserId()
  const room = client.getRoom(roomId)
  const me = myId ? room?.getMember(myId) : null
  const ev = me?.events.member
  if (!ev || me?.membership !== 'invite') return null
  const content = ev.getContent()
  if (!content.is_direct) return null
  const inviter = ev.getSender()
  return inviter && inviter !== myId ? inviter : null
}

// The acceptor's half of the m.direct handshake. Failure is reported, not
// raised: the join already happened, and a conversation that opens but is
// drawn as a room beats one that refuses to open.
export async function adoptDm(client: MatrixClient, userId: string, roomId: string): Promise<void> {
  try {
    await addToDirectMap(client, userId, roomId)
  } catch (err) {
    console.error('[dm] could not adopt the accepted DM into m.direct', err)
  }
}

export interface StartDmResult {
  roomId: string
  // True when an existing DM was reused rather than a new room created.
  existing: boolean
  // Why this DM is or is not encrypted. Null when an existing room was reused,
  // because its encryption was settled when it was created and nothing here
  // decided it -- reporting a fresh decision for a room we did not create
  // would describe a choice that was never made.
  encryption: DmEncryptionDecision | null
}

// Can this user receive encrypted messages at all?
//
// The D-e4 capability check, expressed as the question with a real answer
// rather than as a list of accounts to skip. A lookup failure returns
// `known: false`, NOT a count of zero -- see decideDmEncryption for why the
// two must not collapse.
async function recipientCryptoCapability(
  client: MatrixClient,
  userId: string,
): Promise<{ known: boolean; deviceCount: number }> {
  const crypto = client.getCrypto()
  if (!crypto) return { known: false, deviceCount: 0 }
  try {
    // downloadUncached: we have very likely never spoken to this person, so
    // the local cache is empty and reading it would answer "no devices" for
    // every first conversation -- the exact false negative that would leave
    // every new DM unencrypted while looking like a considered decision.
    const devices = await crypto.getUserDeviceInfo([userId], true)
    return { known: true, deviceCount: devices.get(userId)?.size ?? 0 }
  } catch (err) {
    // Reported, never swallowed (G-tc05).
    console.error('[dm] could not read the recipient device list', err)
    return { known: false, deviceCount: 0 }
  }
}

export async function startDm(client: MatrixClient, userId: string): Promise<StartDmResult> {
  const existing = findExistingDm(client, userId)
  if (existing) return { roomId: existing, existing: true, encryption: null }

  // NEW DMs only. An existing conversation is never silently upgraded: a room
  // that becomes encrypted mid-history has two halves that mean different
  // things, and the user is the one who gets to decide that (D-e5).
  const capability = await recipientCryptoCapability(client, userId)
  const encryption = decideDmEncryption({
    cryptoAvailable: !!client.getCrypto(),
    recipientDeviceCount: capability.deviceCount,
    recipientDevicesKnown: capability.known,
  })

  const { room_id: roomId } = await client.createRoom({
    is_direct: true,
    // trusted_private_chat gives the invitee the same power level as the
    // creator, which is what a two-person conversation should be -- neither
    // party is moderating the other.
    preset: Preset.TrustedPrivateChat,
    visibility: Visibility.Private,
    invite: [userId],
    // Encryption is set AT CREATION, as initial state, so there is no window
    // in which the room exists and is readable by the server. Turning it on
    // afterwards would leave the invite and any racing first message in the
    // clear.
    ...(willEncrypt(encryption)
      ? {
          initial_state: [
            {
              type: EventType.RoomEncryption,
              state_key: '',
              content: { algorithm: 'm.megolm.v1.aes-sha2' },
            },
          ],
        }
      : {}),
  })

  // Written AFTER creation and awaited: if this fails the room exists but is
  // not a DM anywhere, which the caller needs to be able to say.
  await addToDirectMap(client, userId, roomId)
  return { roomId, existing: false, encryption }
}
