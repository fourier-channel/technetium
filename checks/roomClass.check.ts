// Which source decides what a room is, and what "no answer" must mean.
import { stampedClass, classifyRoom, isDirect, CLASS_KEY } from '../src/client/roomClass'
import type { MatrixClient, Room } from 'matrix-js-sdk'

let failures = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name + (extra === undefined ? '' : ' -- ' + JSON.stringify(extra))) }
}

const room = (roomId: string, stamp?: unknown): Room => ({
  roomId,
  currentState: {
    getStateEvents: (type: string) =>
      type === 'm.room.create' && stamp !== undefined
        ? { getContent: () => ({ [CLASS_KEY]: stamp, room_version: '10' }) }
        : (stamp === undefined ? { getContent: () => ({ room_version: '10' }) } : null),
  },
} as unknown as Room)

const client = (direct: string[]): MatrixClient => ({
  getAccountData: () => ({ getContent: () => ({ '@someone:41chan.net': direct }) }),
} as unknown as MatrixClient)

{
  check('a stamped dm is a dm', stampedClass(room('!a', 'dm')) === 'dm')
  check('a stamped room is a room', stampedClass(room('!a', 'room')) === 'room')
  check('an unstamped room has no verdict', stampedClass(room('!a')) === null)
  check('a nonsense stamp is not trusted', stampedClass(room('!a', 'banana')) === null)
}

{
  const c = classifyRoom(client([]), room('!a', 'dm'))
  check('the create event wins and says so', c.klass === 'dm' && c.source === 'create-event', c)
  // The whole point of a server-written stamp: a client lying in m.direct
  // cannot promote a room to a DM.
  const lied = classifyRoom(client(['!a']), room('!a', 'room'))
  check('m.direct cannot override a stamped room', lied.klass === 'room' && lied.source === 'create-event', lied)
}

{
  const legacy = classifyRoom(client(['!old']), room('!old'))
  check('an unstamped room in m.direct is a dm, by the weaker source', legacy.klass === 'dm' && legacy.source === 'm.direct', legacy)
  const nothing = classifyRoom(client([]), room('!old'))
  check('an unstamped room in nothing is UNKNOWN, not "room"', nothing.klass === 'unknown', nothing)
  check('and unknown is not treated as a DM by the list', isDirect(client([]), room('!old')) === false)
}

// Absent must never become "room": every DM on this server predates the stamp.
{
  let wrong = 0
  for (const stamp of [undefined, 'dm', 'room', 'banana']) for (const inDirect of [true, false]) {
    const r = room('!x', stamp as string | undefined)
    const c = classifyRoom(client(inDirect ? ['!x'] : []), r)
    if (stamp === undefined && !inDirect && c.klass !== 'unknown') wrong++
    if (stamp === 'dm' && c.klass !== 'dm') wrong++
  }
  check('no combination turns an absent stamp into a definite answer', wrong === 0, wrong)
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
