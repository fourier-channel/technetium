// A verification that did not succeed must never read as one that did.
import { verificationStage } from '../src/client/verificationStage'

import { readFileSync } from "node:fs"

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

console.log("\n-- both sides must NAME a method, not just agree --")
{
  // Accepting a request only moves it to READY. If neither side then starts a
  // method, both sit on "Compare emojis" forever with no error anywhere. The
  // asking side was fixed for this on 2026-09-07; the ACCEPTING side still had
  // the same hole and it was found live on 2026-09-10, with Element asking.
  //
  // Source-level, because the alternative is two real clients and a person to
  // look at them. It proves the call exists on both paths and is guarded
  // against firing twice -- not that the protocol completes, which only the
  // live run shows.
  const asking = readFileSync("src/client/verification.ts", "utf8")
  const accepting = readFileSync("src/ui/IncomingVerification.tsx", "utf8")
  for (const [name, src] of [["the asking side", asking], ["the accepting side", accepting]]) {
    check(`${name} starts the SAS method itself`,
      /startVerification\(\s*VerificationMethod\.Sas\s*\)/.test(src))
    check(`${name} only starts once`, /!starting/.test(src) && /starting = true/.test(src))
    check(`${name} waits for READY (phase 3) before starting`, /phase === 3/.test(src))
    check(`${name} does not start when a verifier already exists`,
      /!(current|request)\.verifier/.test(src) || /!current\.verifier/.test(src) || /!request\.verifier/.test(src))
  }
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
