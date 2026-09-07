// A verification that did not succeed must never read as one that did.
import { verificationStage } from '../src/client/verificationStage'

let failures = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name + (extra === undefined ? '' : ' -- ' + JSON.stringify(extra))) }
}

check('nothing started says so', verificationStage(null, false).name === 'idle')
check('requested waits on the other device', verificationStage(2, false).name === 'waiting')
check('and says what it is waiting FOR', /accept the request there/i.test(verificationStage(2, false).instruction))
check('started with pictures asks for the comparison', verificationStage(4, true).name === 'compare')
check('started WITHOUT pictures does not ask yet', verificationStage(4, false).canConfirm === false)
check('done is the only verified stage', verificationStage(6, false).verified === true)
check('cancelled is terminal and not verified',
  verificationStage(5, false).terminal && !verificationStage(5, false).verified)
check('cancelled names the mismatch danger rather than shrugging',
  /interceptor/i.test(verificationStage(5, false).instruction))

// --- the invariant, over every phase the SDK can produce and then some -----
{
  let wrongVerified = 0, confirmWithoutEmoji = 0, silent = 0, cancelAfterEnd = 0
  for (const phase of [null, 0, 1, 2, 3, 4, 5, 6, 7, 99]) {
    for (const emoji of [true, false]) {
      const s = verificationStage(phase as number | null, emoji)
      if (s.verified && phase !== 6) wrongVerified++
      if (s.canConfirm && !emoji) confirmWithoutEmoji++
      if (!s.headline || !s.instruction) silent++
      if (s.terminal && s.canCancel) cancelAfterEnd++
    }
  }
  check('only phase 6 is ever verified', wrongVerified === 0, wrongVerified)
  check('never asks "do these match" with nothing to compare', confirmWithoutEmoji === 0, confirmWithoutEmoji)
  check('every phase says something', silent === 0, silent)
  check('nothing offers to cancel something already over', cancelAfterEnd === 0, cancelAfterEnd)
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
