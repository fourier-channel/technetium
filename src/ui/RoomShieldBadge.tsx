import { useEffect, useState } from 'react'
import { RoomStateEvent, type Room } from 'matrix-js-sdk'
import { useClient } from '../client/ClientContext'
import { roomShieldState, shieldCopy, type RoomShieldFacts } from '../client/roomShield'

// ---------------------------------------------------------------------------
// The room's privacy, stated in the header (E9), and never overstated (E10).
//
// The badge shows on encrypted rooms and on rooms whose encryption we cannot
// verify. It deliberately does NOT show on ordinary content rooms: those are
// unencrypted by design, and a "not encrypted" badge on every one of them
// would be noise that trains people to ignore the badge in the one place it
// matters. The full state is still available in the room info panel.
//
// Every fact behind it is read live, because "encrypted" is not a property of
// a room alone -- it depends on whether OUR crypto is working, which can
// change between one render and the next.
// ---------------------------------------------------------------------------

const GLYPH: Record<string, string> = {
  encrypted: '🔒',
  'encrypted-warning': '🔓',
  unverifiable: '⚠',
  'not-encrypted': '',
}

function readFacts(room: Room, cryptoAvailable: boolean): RoomShieldFacts {
  return {
    roomIsEncrypted: room.hasEncryptionStateEvent(),
    cryptoAvailable,
    // Populated by E7, which is what can actually enumerate participant
    // devices. Reported as zero until then rather than guessed at: an invented
    // warning count is its own kind of lie, and the shield's job is to be
    // believed.
    membersWithoutCrypto: 0,
    unverifiedDevices: 0,
  }
}

export function RoomShieldBadge({ room }: { room: Room }) {
  const { client, identityFacts } = useClient()
  // Crypto is usable only when the engine is up AND this device can actually
  // read with it. A device holding no keys can encrypt outgoing messages while
  // being unable to read a word of the conversation, and calling that
  // "encrypted" with a padlock is the false reassurance E10 forbids.
  const cryptoAvailable = !!client?.getCrypto() && !!identityFacts
  const [facts, setFacts] = useState<RoomShieldFacts>(() => readFacts(room, cryptoAvailable))

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      if (!cancelled) setFacts(readFacts(room, cryptoAvailable))
    }
    // Not a sync setState in the effect body (G-tc01) -- deferred, so the
    // first paint uses the initializer above and this only corrects it.
    queueMicrotask(refresh)
    if (!client) return
    // m.room.encryption arrives as state like anything else, and it can arrive
    // while the room is open -- that is the whole point of it being visible.
    client.on(RoomStateEvent.Events, refresh)
    return () => {
      cancelled = true
      client.off(RoomStateEvent.Events, refresh)
    }
  }, [client, room, cryptoAvailable])

  const state = roomShieldState(facts)
  if (state === 'not-encrypted') return null

  const copy = shieldCopy(facts)
  return (
    <span
      className="tc-room-header-shield"
      title={copy.detail}
      style={{
        fontSize: '0.75rem',
        padding: '1px 6px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
        border: '1px solid',
        borderColor:
          state === 'encrypted'
            ? 'var(--cpd-color-text-success-primary, #0dbd8b)'
            : 'var(--cpd-color-text-critical-primary, #d6483b)',
        color:
          state === 'encrypted'
            ? 'var(--cpd-color-text-success-primary, #0dbd8b)'
            : 'var(--cpd-color-text-critical-primary, #d6483b)',
      }}
    >
      {GLYPH[state]} {copy.label}
    </span>
  )
}
