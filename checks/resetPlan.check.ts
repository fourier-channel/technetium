// Checks for E11 -- what a destructive reset costs, and the gate on it.
//
// The failure guarded here is not a wrong label. It is a user throwing away
// history they could have kept, on the strength of a sentence this file
// produced. So the assertions are exhaustive over the input space rather than
// example-based, and the two columns of copy are asserted to be DISJOINT --
// nothing may appear as both kept and lost.
import {
  gateBlockers, gateSatisfied, resetCopy, resetPlan,
  type ResetGate,
} from '../src/client/resetPlan.ts'
import type { CryptoIdentityFacts } from '../src/client/cryptoIdentity.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const ALL: CryptoIdentityFacts[] = []
for (const accountHasIdentity of [false, true])
  for (const privateKeysOnThisDevice of [false, true])
    for (const privateKeysInSecretStorage of [false, true])
      for (const keyBackupVersion of [null, '3'])
        for (const thisDeviceVerified of [false, true])
          for (const otherDeviceCount of [0, 2])
            ALL.push({ accountHasIdentity, privateKeysOnThisDevice, privateKeysInSecretStorage,
              keyBackupVersion, thisDeviceVerified, otherDeviceCount } as CryptoIdentityFacts)

const ME = '@saber:41chan.net'
const open: ResetGate = { exportedOrAcknowledged: true, typedMatrixId: ME }

console.log(`== over all ${ALL.length} states`)
check('an account with NO identity is never offered a meaningful reset',
  ALL.filter((f) => !f.accountHasIdentity).every((f) => !resetPlan(f).meaningful))
check('and its gate refuses outright, however well filled in',
  ALL.filter((f) => !f.accountHasIdentity)
    .every((f) => !gateSatisfied(open, ME, resetPlan(f))))
check('a backup is destroyed exactly when one exists',
  ALL.every((f) => resetPlan(f).destroysKeyBackup === (f.accountHasIdentity && f.keyBackupVersion !== null)))
check('local history is kept in EVERY meaningful reset -- the half people do not expect',
  ALL.filter((f) => f.accountHasIdentity).every((f) => resetPlan(f).keepsLocalHistory))
check('no reset ever claims to keep the backup it destroys',
  ALL.every((f) => !(resetPlan(f).destroysKeyBackup && !resetPlan(f).losesBackedUpHistory)))

console.log('\n== the copy')
for (const f of ALL.filter((x) => x.accountHasIdentity)) {
  const { willLose, willKeep } = resetCopy(resetPlan(f))
  if (willLose.length === 0) { check('a meaningful reset always names a cost', false, f); break }
  // Nothing may be promised and taken away in the same dialog.
  const overlap = willLose.filter((l) => willKeep.includes(l))
  if (overlap.length) { check('kept and lost are disjoint', false, overlap); break }
}
check('a meaningful reset always names at least one cost and one thing kept',
  ALL.filter((f) => f.accountHasIdentity).every((f) => {
    const c = resetCopy(resetPlan(f))
    return c.willLose.length > 0 && c.willKeep.length > 0
  }))
check('G-e2 is honoured: identity loss is described as TRUST, not messages',
  resetCopy(resetPlan(ALL.find((f) => f.accountHasIdentity && f.keyBackupVersion === null)!))
    .willLose.every((l) => !/messages? (are|become) unreadable/i.test(l) || /ONLY in that backup/.test(l)))
check('an account with no identity is offered no copy at all',
  resetCopy(resetPlan({ ...ALL[0], accountHasIdentity: false })).willLose.length === 0)

console.log('\n== the gate (D-e1, D-e2)')
const plan = resetPlan({ ...ALL[0], accountHasIdentity: true, keyBackupVersion: '3' })
check('no export and no acknowledgement blocks it',
  gateBlockers({ exportedOrAcknowledged: false, typedMatrixId: ME }, ME, plan).length > 0)
check('an acknowledgement is accepted in place of an export',
  gateSatisfied({ exportedOrAcknowledged: true, typedMatrixId: ME }, ME, plan))
check('the wrong Matrix ID blocks it',
  !gateSatisfied({ exportedOrAcknowledged: true, typedMatrixId: '@other:41chan.net' }, ME, plan))
check('a NEAR MISS blocks it -- case matters in a localpart',
  !gateSatisfied({ exportedOrAcknowledged: true, typedMatrixId: '@Saber:41chan.net' }, ME, plan))
check('surrounding whitespace is forgiven, since paste adds it',
  gateSatisfied({ exportedOrAcknowledged: true, typedMatrixId: `  ${ME} ` }, ME, plan))
check('an empty box blocks it',
  !gateSatisfied({ exportedOrAcknowledged: true, typedMatrixId: '' }, ME, plan))
check('every blocker is a sentence the user can act on',
  gateBlockers({ exportedOrAcknowledged: false, typedMatrixId: '' }, ME, plan)
    .every((b) => b.length > 20 && /[.]$/.test(b)))
check('two unmet conditions produce two blockers, not one',
  gateBlockers({ exportedOrAcknowledged: false, typedMatrixId: '' }, ME, plan).length === 2)

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
