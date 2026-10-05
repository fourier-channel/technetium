import type { User } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// W4.5 -- what presence a person is shown with, decided from the SDK's User.
//
// Unknown is not offline. When the server has said nothing about someone the
// renderer draws NOTHING: a grey dot for unknown would tell every member of
// the room that everyone is offline, a lie the client invented rather than
// something the server said.
//
// The SDK's User starts life with `presence = "offline"` (models/user.ts), so
// reading that field alone made every person "Offline" -- which is all the
// user list and profile cards ever showed. Only an m.presence event the server
// actually sent counts; a User that never received one is unknown.
// ---------------------------------------------------------------------------

export type PresenceState = 'online' | 'unavailable' | 'offline'

export function presenceOf(user: Pick<User, 'presence' | 'events'> | null | undefined): PresenceState | undefined {
  if (!user?.events.presence) return undefined
  const p = user.presence
  if (p === 'online' || p === 'unavailable' || p === 'offline') return p
  return undefined
}

export function presenceLabel(state: PresenceState | undefined): string | null {
  if (state === 'online') return 'Online'
  if (state === 'unavailable') return 'Away'
  if (state === 'offline') return 'Offline'
  // Deliberately null: unknown is not a status to display.
  return null
}
