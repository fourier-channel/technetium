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

// The join rules the house actually uses. Deliberately not the full spec set:
// knock_restricted and restricted need a resolved allow-list, which is its own
// design question rather than a dropdown entry.
export type HouseJoinRule = 'invite' | 'public' | 'knock'

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

  const initialState: { type: string; state_key: string; content: object }[] = []
  // knock is not expressible through a preset, so it goes in as initial state.
  if (input.joinRule === 'knock') {
    initialState.push({
      type: EventType.RoomJoinRules,
      state_key: '',
      content: { join_rule: JoinRule.Knock },
    })
  }

  const { room_id: roomId } = await client.createRoom({
    name,
    ...(input.topic?.trim() ? { topic: input.topic.trim() } : {}),
    preset: presetFor(input.joinRule),
    // A public room being listed in the directory is a separate decision from
    // its join rule; keep creation quiet and let it be published deliberately.
    visibility: Visibility.Private,
    ...(creationContent ? { creation_content: creationContent } : {}),
    ...(initialState.length > 0 ? { initial_state: initialState } : {}),
  })

  if (!input.parentSpaceId) return { roomId, parented: false }

  try {
    // `via` is required by the spec and is how remote servers find the child.
    const via = client.getDomain()
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
