// Checks for what presence a person is shown with (W4.5, client/presence.ts).
//
// Unknown is not offline. The SDK's User starts with presence = "offline",
// so reading the field alone drew every person in the user list and every
// profile card as "Offline" -- on a server whose sliding sync sends no
// presence at all. Only an m.presence event the server sent makes a state
// known.
import { presenceLabel, presenceOf } from '../src/client/presence.ts'

let failures = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
type U = Parameters<typeof presenceOf>[0]
const user = (presence: string, heard: boolean) => ({ presence, events: heard ? { presence: {} } : {} }) as unknown as U

console.log('\n-- a person the server never reported is unknown, and drawn as nothing --')
{
  check('the SDK default "offline" with no m.presence is unknown', presenceOf(user('offline', false)) === undefined)
  check('and has no label', presenceLabel(presenceOf(user('offline', false))) === null)
  check('no User at all is unknown', presenceOf(null) === undefined && presenceOf(undefined) === undefined)
}

console.log('\n-- what the server did say is shown --')
{
  check('online', presenceOf(user('online', true)) === 'online' && presenceLabel('online') === 'Online')
  check('unavailable reads as Away', presenceOf(user('unavailable', true)) === 'unavailable' && presenceLabel('unavailable') === 'Away')
  check('a reported offline is offline', presenceOf(user('offline', true)) === 'offline' && presenceLabel('offline') === 'Offline')
  check('a state outside the spec is unknown, not guessed', presenceOf(user('busy', true)) === undefined)
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
