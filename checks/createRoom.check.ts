// Checks for W3.9 room creation, focused on the one setting that is permanent.
//
// m.federate lives in m.room.create and CANNOT be changed after creation. A
// room created federating federates forever. That makes the default, and the
// exact shape of creation_content, worth pinning down: every existing room on
// this deployment was created federating because nobody chose otherwise, and by
// the time it was noticed it could not be undone.
import { buildCreationContent, buildInitialState, buildPowerOverride } from '../src/client/createRoom.ts'

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

console.log('\n-- initial_state --')
{
  const SPACE = '!space:example.org'
  const find = (st: { type: string; state_key: string; content: object }[], type: string, key = '') =>
    st.find((e) => e.type === type && e.state_key === key)?.content as Record<string, unknown> | undefined

  // Restricted: the house rule for a room inside a space. Its allow-list is the
  // space it is created in, and nothing else.
  const r = buildInitialState({ joinRule: 'restricted', parentSpaceId: SPACE }, 'example.org')
  const jr = find(r, 'm.room.join_rules')
  check('restricted writes join_rule restricted', jr?.join_rule === 'restricted', jr)
  check('restricted allows members of the parent space, exactly',
    JSON.stringify(jr?.allow) === JSON.stringify([{ type: 'm.room_membership', room_id: SPACE }]), jr)

  // With no space there is nobody the allow-list could admit: refuse before any
  // request is made, rather than create a room nobody can join.
  let threw = false
  try { buildInitialState({ joinRule: 'restricted' }, 'example.org') } catch { threw = true }
  check('restricted without a space is refused before creation', threw)

  // The private_chat preset sets guest_access can_join, which the Server
  // permissions audit reports as a fault. Every rule must override it.
  for (const rule of ['invite', 'knock', 'public', 'restricted'] as const) {
    const st = buildInitialState({ joinRule: rule, parentSpaceId: SPACE }, 'example.org')
    check(`${rule}: guest access forbidden`, find(st, 'm.room.guest_access')?.guest_access === 'forbidden', st)
  }

  // Invite and public come from the preset; knock cannot, so it is state.
  check('invite writes no join_rules (the preset does)',
    find(buildInitialState({ joinRule: 'invite' }, 'example.org'), 'm.room.join_rules') === undefined)
  check('knock writes join_rule knock',
    find(buildInitialState({ joinRule: 'knock' }, 'example.org'), 'm.room.join_rules')?.join_rule === 'knock')

  // Encryption is permanent; it is sent only when asked for.
  check('unencrypted by default',
    find(buildInitialState({ joinRule: 'invite' }, 'example.org'), 'm.room.encryption') === undefined)
  check('encrypted:true writes megolm',
    find(buildInitialState({ joinRule: 'invite', encrypted: true }, 'example.org'), 'm.room.encryption')?.algorithm
      === 'm.megolm.v1.aes-sha2')

  // The room names its space too, canonically, via this server.
  const parent = find(r, 'm.space.parent', SPACE)
  check('a parented room carries m.space.parent for its space',
    parent?.canonical === true && JSON.stringify(parent?.via) === JSON.stringify(['example.org']), parent)
  check('a top-level room carries no m.space.parent',
    !buildInitialState({ joinRule: 'invite' }, 'example.org').some((e) => e.type === 'm.space.parent'))
}

console.log('\n-- power levels --')
{
  // A space's members are every restricted child's allow-list, so the preset's
  // invite: 0 would let any member admit anyone to all of them.
  for (const rule of ['invite', 'knock', 'restricted'] as const) {
    const o = buildPowerOverride({ isSpace: true, joinRule: rule })
    check(`a ${rule} space needs 50 to invite`, o?.invite === 50, o)
    check(`a ${rule} space is not a place to talk`, o?.events_default === 100, o)
  }
  check('a public space lets anyone invite', buildPowerOverride({ isSpace: true, joinRule: 'public' })?.invite === 0)
  // Rooms keep the house's own invite: 0.
  for (const rule of ['invite', 'knock', 'public', 'restricted'] as const) {
    check(`a ${rule} room sends no power override`, buildPowerOverride({ isSpace: false, joinRule: rule }) === undefined)
  }
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
