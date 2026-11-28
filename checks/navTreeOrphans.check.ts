// Checks for where buildNavTree puts a joined room no fetched hierarchy holds
// (bug-20261127-dd94e140, Developer 2026-11-28).
//
// The bug: a room declaring an m.space.parent was held out of the loose rooms
// forever, even when that parent was nowhere in the fetched hierarchy -- an
// invite into a room without its space, or a space under a root you are not
// in. Held and never placed, it had no row and so no unread count. The rule
// now: hold only while a declared parent could still place it.
//
// WHAT THIS CANNOT SEE: the hierarchy a real homeserver returns, or the row
// the tree draws. It proves the placement decision over fake rooms.
import { buildNavTree, type HierarchyRoom } from '../src/client/spaces.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

interface FakeRoom {
  roomId: string
  name: string
  isSpaceRoom(): boolean
  getMyMembership(): string
  currentState: { getStateEvents(t: string): { getContent(): object; getStateKey(): string }[] }
}
function room(roomId: string, parents: Record<string, object> = {}, space = false): FakeRoom {
  return {
    roomId,
    name: roomId.slice(1, 6),
    isSpaceRoom: () => space,
    getMyMembership: () => 'join',
    currentState: {
      getStateEvents: (t: string) =>
        t === 'm.space.parent'
          ? Object.entries(parents).map(([k, c]) => ({ getContent: () => c, getStateKey: () => k }))
          : [],
    },
  }
}
function client(rooms: FakeRoom[]) {
  const byId = new Map(rooms.map((r) => [r.roomId, r]))
  return { getRooms: () => rooms, getRoom: (id: string) => byId.get(id) ?? null } as never
}
const via = { via: ['x'] }
const root: HierarchyRoom = { room_id: '!root', name: 'root', room_type: 'm.space', children_state: [{ state_key: '!kid' }] }
const kid: HierarchyRoom = { room_id: '!kid', name: 'kid' }
const fetched = [root, kid]
const orphanIds = (rooms: FakeRoom[], h: HierarchyRoom[], held = new Set<string>()) =>
  buildNavTree(client(rooms), h, held).orphanRooms.map((n) => n.roomId)

console.log('\n-- a room whose declared parent is unreachable is placed, not lost --')
{
  const lost = room('!lost', { '!elsewhere': via })
  check('placed with the loose rooms once a hierarchy is fetched', orphanIds([room('!root', {}, true), room('!kid'), lost], fetched).includes('!lost'))
  const two = room('!two', { '!elsewhere': via, '!other': via })
  check('every declared parent unreachable: placed', orphanIds([two], fetched).includes('!two'))
}

console.log('\n-- what stays held --')
{
  const coming = room('!coming', { '!root': via })
  check('a declared parent IN the fetched hierarchy holds it (the child link will place it)',
    !orphanIds([coming], fetched).includes('!coming'))
  const mixed = room('!mixed', { '!elsewhere': via, '!root': via })
  check('one reachable parent among several holds it', !orphanIds([mixed], fetched).includes('!mixed'))
  const early = room('!early', { '!elsewhere': via })
  check('nothing fetched yet: held (any parent might still place it)', !orphanIds([early], []).includes('!early'))
  const seen = room('!seen', { '!elsewhere': via })
  check('a room once seen under a space stays held (heldIds wins)', !orphanIds([seen], fetched, new Set(['!seen'])).includes('!seen'))
  check('a room the hierarchy holds is not an orphan', !orphanIds([room('!kid', { '!root': via })], fetched).includes('!kid'))
  check('a space is never a loose room', !orphanIds([room('!sp', { '!elsewhere': via }, true)], fetched).includes('!sp'))
}

console.log('\n-- unchanged: rooms with no parent --')
{
  check('a room declaring no parent is loose', orphanIds([room('!dm')], fetched).includes('!dm'))
  check('and loose before anything is fetched', orphanIds([room('!dm')], []).includes('!dm'))
  const emptyParent = room('!gone', { '!root': {} })
  check('an emptied m.space.parent (content {}) is no parent', orphanIds([emptyParent], fetched).includes('!gone'))
}

// Sabotage control, run 2026-11-28: with the orphan filter put back to the
// old `!hasParentSpace(r)`, the two checks in the first block FAIL and the
// rest pass -- this file sees the bug and nothing else.

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nall ok')
