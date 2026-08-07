// Checks for W3.4 sibling ordering.
import { arrangeSiblings, roomOrderScope } from '../src/ui/roomOrder.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const n = (roomId: string): any => ({ roomId, name: roomId, isSpace: false, membership: 'join', joinRule: null, room: null, children: [] })

console.log('\n-- roomOrderScope --')
{
  check('root scope is the empty string', roomOrderScope(null) === '')
  check('a space scopes by its id', roomOrderScope('!s:x.net') === '!s:x.net')
}

console.log('\n-- arrangeSiblings --')
{
  const nodes = [n('!a'), n('!b'), n('!c')]
  check('no saved order = server order', arrangeSiblings(nodes, undefined).map((x) => x.roomId).join(',') === '!a,!b,!c')
  check('an empty saved order = server order', arrangeSiblings(nodes, []).map((x) => x.roomId).join(',') === '!a,!b,!c')
  check(
    'a full saved order is honoured',
    arrangeSiblings(nodes, ['!c', '!a', '!b']).map((x) => x.roomId).join(',') === '!c,!a,!b',
  )
  // A room joined since the order was saved must be NOTICEABLE, not appended
  // to the bottom of a long space where nobody would see it.
  check(
    'an unknown room sorts FIRST',
    arrangeSiblings(nodes, ['!c', '!a']).map((x) => x.roomId).join(',') === '!b,!c,!a',
  )
  // A stale id (room left) must not leave a hole or throw.
  check(
    'a saved id that no longer exists is skipped',
    arrangeSiblings([n('!a')], ['!gone', '!a']).map((x) => x.roomId).join(',') === '!a',
  )
  check('an empty sibling list stays empty', arrangeSiblings([], ['!a']).length === 0)
  check('the input array is not mutated', (() => { const src = [n('!a'), n('!b')]; arrangeSiblings(src, ['!b','!a']); return src[0].roomId === '!a' })())
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
process.exit(failures === 0 ? 0 : 1)
