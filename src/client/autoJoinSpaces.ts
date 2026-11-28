// Every member is in the same sub-spaces (tc.84; Developer, 2026-11-28): the
// sub-spaces organise the server, so there is no opting out of them. Once a
// person is in the 41chan hub space, Technetium joins them to each sub-space in
// the table below that they are not already in, every session.
//
// BY ROOM ID, NEVER BY NAME. A display name is anyone-with-power's to change,
// and two rooms can share one; the ids were read from the hub space's
// child links. The two invite-only sub-spaces are deliberately not here: they
// must never appear for a person who was not invited, and the server already
// leaves them out of the hierarchy such a person can read.
//
// ONLY FROM INSIDE THE HUB. The open sub-spaces admit members of the hub
// (join rule restricted to it), so a join from outside it is refused. Joining
// the hub itself takes an invite, which is onboarding's business, not this.
//
// A person who has left one is joined again next session (that is what "no
// opting out" means); a person banned from one is left alone, since the join
// can only fail and a ban is a moderator's decision.
//
// Pure: no SDK values, no DOM. Loaded by checks/autoJoinSpaces.check.ts; the
// client wiring is client/autoJoinSpacesWatch.ts.

export const HUB_SPACE_ID = '!jeEGyrShDSyjWSBXJo:41chan.net'

export interface AutoJoinSpace {
  // How the space is spoken of, for the report only; never matched on.
  name: string
  id: string
}

// The five, read 2026-11-28 from the hub's live m.space.child links (all
// m.space, join rule restricted to the hub). The NSFW one is in by the
// Developer's ruling of the same day. Not here: the two invite-only spaces,
// and two rooms whose links were removed from the hub.
export const AUTO_JOIN_SPACES: readonly AutoJoinSpace[] = [
  { name: 'chanviewru', id: '!vlnhcHMGIlolgTsmsk:41chan.net' },
  { name: 'chrestai', id: '!bHuJtptdgyDTeRnjRM:41chan.net' },
  { name: 'degenerative content', id: '!xvtWVeKOoTkqSevjsU:41chan.net' },
  { name: 'generative content', id: '!UkoaWcdzvGVqYylxtn:41chan.net' },
  { name: 'get help', id: '!JTbiQKasQYFLtfcEUC:41chan.net' },
]

const ROOM_ID = /^![A-Za-z0-9._~-]+:[A-Za-z0-9.-]+$/

export function validRoomId(id: unknown): id is string {
  return typeof id === 'string' && id.length <= 255 && ROOM_ID.test(id)
}

// The spaces to join now, in table order. `membership` answers the person's
// own membership of a room id ('join', 'invite', 'leave', 'ban', 'knock'), or
// undefined where the client knows no such room.
export function spacesToJoin(
  membership: (roomId: string) => string | undefined,
  table: readonly AutoJoinSpace[] = AUTO_JOIN_SPACES,
  hub: string = HUB_SPACE_ID,
): AutoJoinSpace[] {
  if (membership(hub) !== 'join') return []
  const seen = new Set<string>()
  const out: AutoJoinSpace[] = []
  for (const s of table) {
    if (!validRoomId(s.id) || seen.has(s.id)) continue
    seen.add(s.id)
    const m = membership(s.id)
    if (m === 'join' || m === 'ban') continue
    out.push(s)
  }
  return out
}

// What a failed join is reported as: which space, what the server said, and
// what fixes it (memory errors-must-carry-their-own-remedy).
export function joinFailureText(space: AutoJoinSpace, detail: string): string {
  return `could not join the ${space.name} sub-space (${space.id}): ${detail}. ` +
    'Every member of the hub joins it; check that its join rule still admits hub members ' +
    'and that the id in client/autoJoinSpaces.ts is still the space in the hub hierarchy'
}
