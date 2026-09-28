import { EventType, JoinRule, Preset, Visibility, type MatrixClient } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// W3.9 -- creating a room or a space.
//
// The interesting part is PARENTING. A room becomes a child of a space by
// writing `m.space.child` INTO THE SPACE, which needs power in the space --
// not in the new room. So creation can succeed and parenting still fail, and
// the user is left with a real room they cannot see in the nav.
//
// This never half-creates silently: when the child write fails the room id is
// reported back so the operator can adopt it by hand.
// ---------------------------------------------------------------------------

// The join rules the house actually uses. `restricted` is the one every room
// inside a space here carries (read off the live hierarchy 2026-09-28: all 16
// children, in all four sub-spaces), and its allow-list is resolved the only
// way the house uses it -- members of the space the room is created in. It
// therefore needs a parent, and says so rather than guessing one.
// knock_restricted is still not offered: nothing here uses it.
export type HouseJoinRule = 'invite' | 'public' | 'knock' | 'restricted'

export interface CreateRoomInput {
  name: string
  topic?: string
  isSpace: boolean
  joinRule: HouseJoinRule
  // Whether this room may be replicated to other homeservers.
  //
  // DEFAULT OFF, and PERMANENT. `m.federate` lives in `m.room.create` and
  // cannot be changed afterwards -- a room created federating federates
  // forever, and the only remedy is creating a new one and migrating.
  //
  // Default-off is a reversal of Matrix's default, chosen deliberately on
  // 2026-08-15: every existing room had been created federating without
  // anyone deciding to, and by the time that was noticed it could not be
  // undone. A default you can opt out of beats a default you cannot undo.
  federate?: boolean
  // Space to parent the new room under, if any.
  parentSpaceId?: string
  // End-to-end encryption, from the first event. DEFAULT OFF, and PERMANENT
  // the other way: once m.room.encryption is set it can never be removed. Off
  // is the default because this site's bots speak through the hub, which does
  // not encrypt -- a bot room created encrypted is a room they cannot use, and
  // nothing undoes it.
  encrypted?: boolean
}

export interface CreateRoomOutcome {
  roomId: string
  // True when a parent was requested AND the m.space.child write landed.
  parented: boolean
  // Set when the room was created but parenting failed. The room EXISTS.
  parentError?: string
}


// creation_content carries BOTH the space marker and the federation flag,
// because both are properties of m.room.create and NEITHER can be set
// afterwards. Extracted so the permanent decision is checkable.
//
// m.federate is emitted only when DISABLING federation: omitting it means
// true, which is the spec default, so writing `m.federate: true` explicitly
// would add noise without changing anything. Returns undefined when there is
// nothing to say, so an ordinary room sends no creation_content at all.
export function buildCreationContent(input: {
  isSpace: boolean
  federate?: boolean
}): Record<string, unknown> | undefined {
  const content: Record<string, unknown> = {}
  if (input.isSpace) content.type = 'm.space'
  if (input.federate === false) content['m.federate'] = false
  return Object.keys(content).length > 0 ? content : undefined
}

// The state that goes in with the room, so it is born with its settings rather
// than acquiring them in a second round of writes a failure could interrupt.
//
// GUEST ACCESS IS WRITTEN EVERY TIME. The private_chat preset -- which every
// non-public room uses -- sets guest_access to can_join, and the Server
// permissions audit calls that a fault ("anyone can read and post here without
// an account"). A dialog that created faulty rooms by default would be
// creating the findings the panel beside it reports.
export function buildInitialState(
  input: { joinRule: HouseJoinRule; parentSpaceId?: string; encrypted?: boolean },
  domain: string | null,
): { type: string; state_key: string; content: object }[] {
  const state: { type: string; state_key: string; content: object }[] = []
  if (input.joinRule === 'restricted') {
    if (!input.parentSpaceId) {
      throw new Error('"Members of its space" needs a space to put the room in. Pick one, or choose another rule.')
    }
    state.push({
      type: EventType.RoomJoinRules,
      state_key: '',
      content: {
        join_rule: JoinRule.Restricted,
        allow: [{ type: 'm.room_membership', room_id: input.parentSpaceId }],
      },
    })
  }
  // knock is not expressible through a preset, so it goes in as initial state.
  if (input.joinRule === 'knock') {
    state.push({
      type: EventType.RoomJoinRules,
      state_key: '',
      content: { join_rule: JoinRule.Knock },
    })
  }
  state.push({ type: EventType.RoomGuestAccess, state_key: '', content: { guest_access: 'forbidden' } })
  if (input.encrypted) {
    state.push({ type: EventType.RoomEncryption, state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } })
  }
  // The room names its space as well as the space naming the room. The child
  // link (written below, into the SPACE) is what puts it in the nav; this one
  // is what other clients read to show where a room belongs, and it can be
  // written here because the creator holds full power in its own new room.
  if (input.parentSpaceId) {
    state.push({
      type: EventType.SpaceParent,
      state_key: input.parentSpaceId,
      content: { via: domain ? [domain] : [], canonical: true },
    })
  }
  return state
}

// A SPACE is a door to every restricted room under it: membership of the space
// IS the allow-list. So who may invite into one matters more than into a room,
// and the private_chat preset's invite: 0 would let any member bring anyone
// in, and through it into every child. 50 is what the 41chan space holds
// (measured 2026-09-26). events_default 100 because nobody talks in a space --
// it is what Element sends for one too. Rooms keep the preset's invite: 0,
// which is what the house's rooms run (chat, measured 2026-09-20).
export function buildPowerOverride(input: {
  isSpace: boolean
  joinRule: HouseJoinRule
}): Record<string, unknown> | undefined {
  if (!input.isSpace) return undefined
  return { events_default: 100, invite: input.joinRule === 'public' ? 0 : 50 }
}

function presetFor(rule: HouseJoinRule): Preset {
  return rule === 'public' ? Preset.PublicChat : Preset.PrivateChat
}

export async function createRoom(
  client: MatrixClient,
  input: CreateRoomInput,
): Promise<CreateRoomOutcome> {
  const name = input.name.trim()
  if (!name) throw new Error('A name is required.')

  const creationContent = buildCreationContent(input)
  const via = client.getDomain()
  // Built BEFORE the request, so a restricted room with no space is refused
  // here rather than created with an allow-list that admits nobody.
  const initialState = buildInitialState(input, via)
  const powerOverride = buildPowerOverride(input)

  const { room_id: roomId } = await client.createRoom({
    name,
    ...(input.topic?.trim() ? { topic: input.topic.trim() } : {}),
    preset: presetFor(input.joinRule),
    // A public room being listed in the directory is a separate decision from
    // its join rule; keep creation quiet and let it be published deliberately.
    visibility: Visibility.Private,
    ...(creationContent ? { creation_content: creationContent } : {}),
    ...(initialState.length > 0 ? { initial_state: initialState } : {}),
    ...(powerOverride ? { power_level_content_override: powerOverride } : {}),
  })

  if (!input.parentSpaceId) return { roomId, parented: false }

  try {
    // `via` is required by the spec and is how remote servers find the child.
    await client.sendStateEvent(
      input.parentSpaceId,
      EventType.SpaceChild,
      { via: via ? [via] : [] },
      roomId,
    )
    return { roomId, parented: true }
  } catch (err) {
    const e = err as { httpStatus?: number; errcode?: string; message?: string }
    const reason =
      e?.httpStatus === 403 || e?.errcode === 'M_FORBIDDEN'
        ? 'you do not have permission to add rooms to that space'
        : (e?.message ?? 'the space could not be updated')
    return { roomId, parented: false, parentError: reason }
  }
}
