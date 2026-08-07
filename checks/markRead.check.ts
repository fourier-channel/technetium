// Checks for W3.1's node flattening. See checks/relations.check.ts for how
// these run (`npm run check`).
import { collectJoinedRooms } from '../src/client/markRead.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log('  ok   ' + name)
  } else {
    failures++
    console.log('  FAIL ' + name, extra ?? '')
  }
}

const room = (roomId: string, membership = 'join', children: any[] = []): any => ({
  roomId,
  name: roomId,
  isSpace: false,
  membership,
  joinRule: null,
  room: null,
  children,
})
const space = (roomId: string, children: any[], membership = 'join'): any => ({
  roomId,
  name: roomId,
  isSpace: true,
  membership,
  joinRule: null,
  room: null,
  children,
})

console.log('\n-- collectJoinedRooms --')
{
  check('a plain room is itself', collectJoinedRooms(room('!a')).join(',') === '!a')

  // A space is a container; receipting the space itself would be meaningless.
  check('a space contributes only its children', collectJoinedRooms(space('!s', [room('!a')])).join(',') === '!a')

  check(
    'nested spaces are walked',
    collectJoinedRooms(space('!s', [room('!a'), space('!s2', [room('!b')])])).join(',') === '!a,!b',
  )

  // An invited-but-not-joined room cannot be receipted, and neither can a left
  // one.
  check(
    'invited and left rooms are excluded',
    collectJoinedRooms(space('!s', [room('!a'), room('!b', 'invite'), room('!c', 'leave')])).join(',') === '!a',
  )

  // The same room legitimately appears under two spaces.
  const shared = room('!dup')
  check(
    'a room under two spaces is receipted once',
    collectJoinedRooms(space('!s', [space('!x', [shared]), space('!y', [shared])])).join(',') === '!dup',
  )

  check('an empty space yields nothing', collectJoinedRooms(space('!s', [])).length === 0)

  // Order is depth-first, which is the order the user sees in the nav.
  check(
    'depth-first order preserved',
    collectJoinedRooms(space('!s', [room('!a'), space('!x', [room('!b')]), room('!c')])).join(',') ===
      '!a,!b,!c',
  )
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
process.exit(failures === 0 ? 0 : 1)
