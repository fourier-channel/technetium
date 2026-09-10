// Checks for sessionIdentity: may a refresher persist, and does a stored
// session match the device the server names.
//
// The bug this guards was found on the operator's own account on 2026-09-10:
// a tab on an older login wrote its refreshed tokens over a newer login's
// record, and the newer tab resumed as one device carrying another's token.
// The interesting failure is the one that FAILS SAFE in the wrong direction:
// a guard that persists when in doubt re-creates the bug, and a comparison
// that calls "no device in whoami" a mismatch signs everyone out. Both edges
// are pinned here.
import {
  persistVerdict,
  compareDevice,
  describeForeignTokens,
  ForeignTokensError,
} from '../src/client/sessionIdentity.ts'
import { planSessionEnd } from '../src/client/sessionEnd.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

// Persisting.
check('own device: persist', persistVerdict({ deviceId: 'AAAA' }, 'AAAA') === 'persist')
check('other device: never persist', persistVerdict({ deviceId: 'AAAA' }, 'BBBB') === 'foreign-device')
check('signed out meanwhile: nothing to write', persistVerdict(null, 'AAAA') === 'no-session')
// The exact shape of the incident, by name, so the regression reads as one.
check(
  'the 2026-09-10 shape: old tab (Za3) may not write into the record naming 7p',
  persistVerdict({ deviceId: '7pISD02Vsw' }, 'Za3UFulvTE') === 'foreign-device',
)

// Comparing.
check('same device: match', compareDevice('AAAA', 'AAAA') === 'match')
check('different device: mismatch', compareDevice('AAAA', 'BBBB') === 'mismatch')
check('whoami without a device is not a mismatch', compareDevice('AAAA', undefined) === 'unknown')
check('an empty device id is treated as absent, not as a different device', compareDevice('AAAA', '') === 'unknown')

// The error names both sides and the message tells the user what to do about
// the other tab -- without that instruction the bug recurs on the next refresh.
const err = new ForeignTokensError('7pISD02Vsw', 'Za3UFulvTE')
check('error is distinguishable by type', err instanceof ForeignTokensError && err.name === 'ForeignTokensError')
check('error carries both ids', err.storedDeviceId === '7pISD02Vsw' && err.actualDeviceId === 'Za3UFulvTE')
check('message names both devices', err.message.includes('7pISD02Vsw') && err.message.includes('Za3UFulvTE'))
check('message tells the user to close other tabs', /close any other technetium tabs/i.test(describeForeignTokens('a', 'b')))
check('message tells the user to sign in again', /sign in again/i.test(describeForeignTokens('a', 'b')))

// Ending for this reason clears the shared record (so the other tab stops
// writing) and keeps the cache (same user), exactly like a failed resume.
const plan = planSessionEnd('foreign_tokens')
check('foreign_tokens clears the stored session', plan.clearStoredSession)
check('foreign_tokens keeps the sync cache, like resume_failed',
  JSON.stringify(plan) === JSON.stringify(planSessionEnd('resume_failed')))
check('foreign_tokens never touches the crypto store', plan.deleteCryptoStore === false)

if (failures > 0) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nall sessionIdentity checks passed')
