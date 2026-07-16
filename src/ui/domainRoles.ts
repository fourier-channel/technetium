import type { MatrixClient, Room } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// Domain admin gating. Kept out of any component file so fast-refresh stays
// happy, and so both the options panel and the avatar menu (force-collapse)
// share ONE threshold. PL >= 50 (mod/op) matches the state-write power an admin
// needs to actually change the domain for everyone.
// ---------------------------------------------------------------------------

// Admin/mod threshold. A single named var so the gate is easy to retune.
export const DOMAIN_ADMIN_PL = 50

export function domainPowerLevel(client: MatrixClient, room: Room): number {
  const me = client.getUserId()
  return (me ? room.getMember(me)?.powerLevel : 0) ?? 0
}

export function isDomainAdmin(client: MatrixClient, room: Room): boolean {
  return domainPowerLevel(client, room) >= DOMAIN_ADMIN_PL
}
