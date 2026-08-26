// ---------------------------------------------------------------------------
// What we are allowed to claim about a room's privacy.
//
// This is E10 as a function. The campaign's law is "never fake a state", and
// the state most worth faking is this one: a padlock is cheap to draw and
// enormously expensive to be wrong about. Someone who believes a conversation
// is end-to-end encrypted will say things in it they would not otherwise say.
//
// So the rule enforced here, and asserted over the whole input space, is:
//
//     the client claims encryption ONLY when it could verify that claim.
//
// "The room has an encryption state event" is NOT sufficient. If our own
// crypto engine is not running we cannot decrypt anything, cannot check who
// the recipients are, and cannot tell a working encrypted room from a broken
// one -- so we say we do not know, which is true, rather than drawing a shield
// we have not earned.
//
// Pure, so the harness can load it (O-tp9).
// ---------------------------------------------------------------------------

export interface RoomShieldFacts {
  // Does the room carry an m.room.encryption state event?
  roomIsEncrypted: boolean
  // Is our own crypto engine up and usable?
  cryptoAvailable: boolean
  // Are there participants who cannot receive encrypted messages at all?
  // In an encrypted room this means part of the conversation is unreadable to
  // them -- worth saying, because from their side it looks like silence.
  membersWithoutCrypto: number
  // Devices in the room we have not verified. Warned about, never blocking
  // (O-e5): a client that refuses to send is a client people stop using.
  unverifiedDevices: number
}

export type ShieldState =
  // Encrypted, and we can stand behind that.
  | 'encrypted'
  // Encrypted, but something about the participants deserves saying.
  | 'encrypted-warning'
  // Not encrypted, and we are sure.
  | 'not-encrypted'
  // The room claims encryption but we cannot verify or use it. Never drawn as
  // a shield.
  | 'unverifiable'

export function roomShieldState(f: RoomShieldFacts): ShieldState {
  if (!f.roomIsEncrypted) return 'not-encrypted'
  // The room says encrypted, but we cannot read it, cannot check it, and
  // cannot tell working from broken. Saying "encrypted" here would be
  // repeating the room's claim as though we had checked it.
  if (!f.cryptoAvailable) return 'unverifiable'
  if (f.membersWithoutCrypto > 0 || f.unverifiedDevices > 0) return 'encrypted-warning'
  return 'encrypted'
}

// Whether the UI may present this room as private. The ONE predicate every
// surface asks, so there is a single place to audit.
export function claimsPrivacy(s: ShieldState): boolean {
  return s === 'encrypted' || s === 'encrypted-warning'
}

export interface ShieldCopy {
  // Short, for a header badge.
  label: string
  // Full, for a tooltip or a room-info panel.
  detail: string
}

export function shieldCopy(f: RoomShieldFacts): ShieldCopy {
  const state = roomShieldState(f)
  switch (state) {
    case 'encrypted':
      return {
        label: 'Encrypted',
        detail:
          'Messages here are end-to-end encrypted. Only the people in this conversation can read them.',
      }
    case 'encrypted-warning': {
      // Two different warnings, and they are not interchangeable. One says
      // somebody cannot read you; the other says somebody might not be who
      // you think. Merging them into a generic caution loses the only
      // information the user could act on.
      if (f.membersWithoutCrypto > 0) {
        return {
          label: 'Encrypted, with a gap',
          detail: `Messages here are encrypted, but ${f.membersWithoutCrypto} participant${
            f.membersWithoutCrypto === 1 ? '' : 's'
          } cannot receive encrypted messages and will not see them.`,
        }
      }
      return {
        label: 'Encrypted, unverified',
        detail: `Messages here are encrypted, but ${f.unverifiedDevices} device${
          f.unverifiedDevices === 1 ? '' : 's'
        } in this conversation ${f.unverifiedDevices === 1 ? 'has' : 'have'} not been verified. You can still send; verify to be sure who is reading.`,
      }
    }
    case 'not-encrypted':
      return {
        label: 'Not encrypted',
        detail:
          'Messages here are not encrypted. The server can read them. This is how content rooms are meant to work.',
      }
    case 'unverifiable':
      return {
        label: 'Encryption unavailable',
        detail:
          'This conversation is marked encrypted, but encryption is not working on this device, so nothing here can be read or verified. Do not treat it as private on this device.',
      }
  }
}
