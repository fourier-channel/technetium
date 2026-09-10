// Checks for the session-end policy.
//
// Two things are worth guarding here and neither is arithmetic. The first is
// the operator's 2026-09-07 ruling that a REVOKED session is treated exactly
// like an explicit logout, cache drop included -- asserted as an equality
// between the two plans, so adding a field to one without the other fails.
// The second is that no reason, ever, deletes the crypto store: that is the
// mistake with the worst blast radius available in this file, and it would be
// a one-word edit away.
//
// The third case, resume_failed, keeps the cache on purpose. It is checked as
// a DIFFERENCE from logout so that someone "simplifying" the function into a
// constant has to fail a test to do it.
import {
  planSessionEnd,
  SESSION_END_REASONS,
  type SessionEndReason,
} from '../src/client/sessionEnd.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const logout = planSessionEnd('logout')
const revoked = planSessionEnd('revoked')
const resumeFailed = planSessionEnd('resume_failed')

// The ruling, structurally.
check(
  'revoked is identical to logout (operator ruling 2026-09-07)',
  JSON.stringify(revoked) === JSON.stringify(logout),
  { revoked, logout },
)

// The bug that started this: a session that has ended must not keep syncing.
for (const reason of SESSION_END_REASONS) {
  check(
    `${reason} stops the client`,
    planSessionEnd(reason).stopClient === true,
  )
  check(
    `${reason} clears the stored session`,
    planSessionEnd(reason).clearStoredSession === true,
  )
  check(
    `${reason} never deletes the crypto store`,
    planSessionEnd(reason).deleteCryptoStore === false,
  )
}

// The deliberate exception, asserted as a difference so it cannot be
// flattened away.
check(
  'resume_failed KEEPS the sync cache',
  resumeFailed.deleteSyncStore === false,
)
check(
  'logout DROPS the sync cache',
  logout.deleteSyncStore === true,
)
check(
  'resume_failed differs from logout in exactly the cache field',
  JSON.stringify({ ...resumeFailed, deleteSyncStore: logout.deleteSyncStore })
    === JSON.stringify(logout),
  { resumeFailed, logout },
)

// Guard the reason list itself: a reason added to the type but not to
// SESSION_END_REASONS would silently escape every loop above.
const covered = new Set<SessionEndReason>(SESSION_END_REASONS)
check(
  'every reason the planner handles is listed in SESSION_END_REASONS',
  covered.has('logout') && covered.has('revoked') && covered.has('resume_failed')
    && covered.has('foreign_tokens') && covered.size === 4,
  [...covered],
)

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nall ok')
