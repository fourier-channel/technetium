// Checks for W3.9 room creation, focused on the one setting that is permanent.
//
// m.federate lives in m.room.create and CANNOT be changed after creation. A
// room created federating federates forever. That makes the default, and the
// exact shape of creation_content, worth pinning down: every existing room on
// this deployment was created federating because nobody chose otherwise, and by
// the time it was noticed it could not be undone.
import { buildCreationContent } from '../src/client/createRoom.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

console.log('\n-- creation_content --')
{
  // Default (federate omitted) must NOT silently federate: the dialog defaults
  // the checkbox off, and this asserts the client half agrees.
  check('federate:false emits m.federate false',
    buildCreationContent({ isSpace: false, federate: false })?.['m.federate'] === false)
  check('federate:true omits the key entirely (true is the spec default)',
    buildCreationContent({ isSpace: false, federate: true }) === undefined)
  check('a space still declares its type',
    buildCreationContent({ isSpace: true, federate: true })?.type === 'm.space')
  const both = buildCreationContent({ isSpace: true, federate: false })
  check('a non-federating space carries BOTH keys',
    both?.type === 'm.space' && both?.['m.federate'] === false, both)
  // Nothing to say means nothing sent, rather than an empty object.
  check('an ordinary federating room sends no creation_content',
    buildCreationContent({ isSpace: false, federate: true }) === undefined)
  check('undefined federate is treated as federating (spec default)',
    buildCreationContent({ isSpace: false }) === undefined)
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
