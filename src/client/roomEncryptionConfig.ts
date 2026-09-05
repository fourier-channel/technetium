import type { MatrixClient, Room } from 'matrix-js-sdk'
import { EventType, ClientEvent, RoomEvent, RoomStateEvent } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// Configuring the crypto engine for a room you JOIN into, rather than watch
// become encrypted.
//
// !!! ONE FRAGILE ASSUMPTION, ISOLATED HERE (same discipline as slidingSync
//     and the wasm meter in crypto.ts) !!!
//
// The rust crypto engine only builds a room's OUTBOUND encryptor when the sync
// loop hands it a *fresh* m.room.encryption state event
// (RustCrypto.onCryptoEvent, called from sync.js for events in a sync's final
// state block). That is fine for a room that turns encryption on while you are
// in it, and fine for a room present in your very first sync.
//
// It is NOT fine for accepting an invite to an ALREADY-encrypted room. The
// invite's stripped state can make room.hasEncryptionStateEvent() true before
// you join, so when the join sync arrives the encryption event is not "new" and
// onCryptoEvent never fires. The room then has an encryption state event but no
// encryptor: decryption still works (inbound keys arrive via to-device,
// independent of this), but the first SEND throws "Cannot encrypt event in
// unconfigured room". A full reload fixes it because the initial sync delivers
// the event fresh -- which is exactly the asymmetry proven live 2026-09-05 with
// two test accounts: B accepted an encrypted DM, decrypted A's message, and
// could not reply until reload.
//
// There is no public CryptoApi call that creates the encryptor after the fact:
// prepareToEncrypt only primes an encryptor that already exists, and
// isEncryptionEnabledInRoom only reports. So we call the one method the sync
// loop itself calls, onCryptoEvent, through a single narrow cast quarantined in
// this file. It is idempotent (create-or-update) and guarded by
// isEncryptionEnabledInRoom, so at worst it does nothing.
//
// If a future SDK exposes a supported "configure this room now" call, this
// whole file collapses to that one call.
// ---------------------------------------------------------------------------

// The internal shape we depend on, named so the dependency is legible and the
// cast is one line rather than scattered `any`s.
type CryptoWithOnEvent = {
  isEncryptionEnabledInRoom(roomId: string): Promise<boolean>
  onCryptoEvent(room: Room, event: unknown): Promise<void>
  // Public CryptoApi, listed here so one cast covers the whole call site.
  prepareToEncrypt(room: Room): void
}

function encryptionStateEvent(room: Room): unknown | null {
  return room.currentState.getStateEvents(EventType.RoomEncryption, '') ?? null
}

// Make sure the crypto engine has an outbound encryptor for this room, if the
// room is encrypted and joined. Safe to call repeatedly and on plaintext rooms.
async function ensureConfigured(client: MatrixClient, room: Room): Promise<void> {
  if (room.getMyMembership() !== 'join') return
  if (!room.hasEncryptionStateEvent()) return
  const event = encryptionStateEvent(room)
  if (!event) return

  const crypto = client.getCrypto() as unknown as CryptoWithOnEvent | undefined
  if (!crypto) return
  try {
    // Load the member list BEFORE building the encryptor. RoomEncryptor's
    // constructor tracks exactly room.getJoinedMembers() as known at that
    // instant, and either side of a brand-new DM can be missing the other:
    // the acceptor has just joined, the creator has just invited. A key shared
    // with a member list of one is a message nobody else can read (seen live
    // 2026-09-05, both directions).
    await room.loadMembersIfNeeded()

    // The one quarantined call, only when the encryptor is actually absent.
    // Feeds crypto the same event the sync loop would have.
    if (!(await crypto.isEncryptionEnabledInRoom(room.roomId))) {
      await crypto.onCryptoEvent(room, event)
    }

    // ALWAYS, including for a room that was already configured: this is what
    // shares the session with everyone currently in the room, and the creator
    // of a DM has an encryptor from the moment of creation while the invitee
    // is not yet in their member list. Returning early on "already configured"
    // would skip exactly the case this is here to fix.
    crypto.prepareToEncrypt(room)
  } catch (err) {
    // Reported, never swallowed (G-tc05). A failure here means the next send in
    // this room will surface the SDK's own "unconfigured room" error, which is
    // the honest state -- better than a silent half-fix.
    console.error('[crypto] could not configure room encryption after join', room.roomId, err)
  }
}

// The accept-an-invite path, made explicit and awaitable. Right after
// client.joinRoom() the encryption state event may not yet be in currentState
// (it can ride the join sync that lands a beat later), so this polls briefly
// for it before configuring. Returns once the room is configured or the wait
// is spent -- callers can then let the user send without hitting "unconfigured
// room". Idempotent and safe on plaintext rooms (it returns as soon as it can
// see the room is not encrypted... which it cannot prove, so it simply spends
// the short wait and returns; a plaintext room never needs an encryptor).
export async function configureRoomEncryptionNow(
  client: MatrixClient,
  roomId: string,
  {
    attempts = 16,
    intervalMs = 500,
    // The person on the other end. We wait for them to be VISIBLE in the room
    // (invited or joined) before sharing the session, because sharing to a
    // member list that does not yet contain them is the whole failure. Waiting
    // is safe: if they never appear we configure anyway on the last tick, and
    // the SDK re-resolves members on every send regardless.
    waitForUserId,
  }: { attempts?: number; intervalMs?: number; waitForUserId?: string | null } = {},
): Promise<void> {
  // No crypto engine means nothing to configure and nothing to wait for. This
  // is the ordinary case while VITE_E2EE is off, and without it the poll below
  // would spend its whole budget before letting the caller open a plaintext
  // conversation.
  if (!client.getCrypto()) return

  const counterpartVisible = (room: Room): boolean => {
    if (!waitForUserId) return true
    const m = room.getMember(waitForUserId)
    return m?.membership === 'join' || m?.membership === 'invite'
  }

  for (let i = 0; i < attempts; i++) {
    const room = client.getRoom(roomId)
    if (
      room?.getMyMembership() === 'join' &&
      room.hasEncryptionStateEvent() &&
      counterpartVisible(room)
    ) {
      await ensureConfigured(client, room)
      return
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  // Last look: a joined encrypted room whose state arrived on the final tick.
  const room = client.getRoom(roomId)
  if (room) await ensureConfigured(client, room)
}

// Watch for rooms that arrive already-encrypted-and-joined and configure them.
// Returns a cleanup that detaches every listener.
//
// Three triggers, because the encryption state and the join can land in either
// order and either may already be true when we start:
//   - MyMembership -> a room we just joined
//   - RoomState.events -> the encryption event landing after the join
//   - a one-time sweep on PREPARED, for rooms already joined at startup that
//     the sync-loop path missed (the reload case, made automatic)
export function watchRoomEncryptionConfig(client: MatrixClient): () => void {
  const onMembership = (room: Room) => {
    void ensureConfigured(client, room)
  }
  const onStateEvent = (event: { getType(): string; getRoomId(): string | undefined }) => {
    if (event.getType() !== EventType.RoomEncryption) return
    const roomId = event.getRoomId()
    const room = roomId ? client.getRoom(roomId) : null
    if (room) void ensureConfigured(client, room)
  }
  const sweep = () => {
    for (const room of client.getRooms()) void ensureConfigured(client, room)
  }

  client.on(RoomEvent.MyMembership, onMembership)
  client.on(RoomStateEvent.Events, onStateEvent)
  client.once(ClientEvent.Sync, (state: string) => {
    if (state === 'PREPARED') sweep()
  })

  return () => {
    client.off(RoomEvent.MyMembership, onMembership)
    client.off(RoomStateEvent.Events, onStateEvent)
  }
}
