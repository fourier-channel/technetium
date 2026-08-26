// Checks for how an unreadable message explains itself.
//
// Two failures are guarded here, and the second is the one that bit.
//
// A padlock that never explains itself is D-tp16 unapplied: an unreadable
// message and a lost message look identical from where the user sits, so a
// reason the user can act on has to be distinguishable from one they cannot.
//
// And the taxonomy has to stay level with the SDK. A future version adding a
// failure code would otherwise land silently in the unknown bucket, which is
// honest but useless -- so the enum is read from the installed SDK and
// compared, per D-tc01.
import { readFileSync } from 'node:fs'
import {
  explainDecryptionFailure,
  explainUnreadable,
  isDecryptionPending,
  knownFailureCodes,
  type DecryptionOutlook,
} from '../src/client/decryptionState.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

console.log('\n-- the taxonomy covers every code the SDK can produce (D-tc01) --')
{
  // Read the enum out of the installed SDK rather than restating it here: a
  // list maintained by hand in two places is a list that disagrees with itself
  // by the next minor version.
  const dts = readFileSync('node_modules/matrix-js-sdk/lib/crypto-api/index.d.ts', 'utf8')
  const block = dts.match(/export declare enum DecryptionFailureCode \{([\s\S]*?)\n\}/)
  check('the SDK still declares DecryptionFailureCode', !!block)

  const sdkCodes = [...(block?.[1] ?? '').matchAll(/^\s+([A-Z0-9_]+)\s*=/gm)].map((m) => m[1])
  check('the enum parsed to something', sdkCodes.length > 5, sdkCodes.length)

  const known = new Set(knownFailureCodes())
  const missing = sdkCodes.filter((c) => !known.has(c))
  check('every SDK failure code has an explanation', missing.length === 0, missing)

  const stale = knownFailureCodes().filter((c) => !sdkCodes.includes(c))
  check('no explanation refers to a code the SDK no longer has', stale.length === 0, stale)
}

console.log('\n-- fixable and unfixable are never confused --')
{
  // THE distinction. One of these is thirty seconds of work; the other is
  // permanent. They arrive as the same padlock.
  check('an unverified device is actionable',
    explainDecryptionFailure('MEGOLM_KEY_WITHHELD_FOR_UNVERIFIED_DEVICE').outlook === 'actionable')
  check('a deliberate withhold is permanent, not actionable',
    explainDecryptionFailure('MEGOLM_KEY_WITHHELD').outlook === 'permanent')
  check('history with no backup is permanent',
    explainDecryptionFailure('HISTORICAL_MESSAGE_NO_KEY_BACKUP').outlook === 'permanent')
  // The difference between these two is the whole value of the file: same
  // situation, except one has a backup to restore from.
  check('history WITH an unconfigured backup is actionable',
    explainDecryptionFailure('HISTORICAL_MESSAGE_BACKUP_UNCONFIGURED').outlook === 'actionable')
  check('a working backup is pending, not actionable',
    explainDecryptionFailure('HISTORICAL_MESSAGE_WORKING_BACKUP').outlook === 'pending')
  check('missing keys are pending',
    explainDecryptionFailure('MEGOLM_UNKNOWN_INBOUND_SESSION_ID').outlook === 'pending')
}

console.log('\n-- an unknown reason is never dressed up as a known one --')
{
  // A code from a future SDK must not be mapped onto the nearest familiar
  // reason: that produces a confident, possibly untrue sentence about
  // someone's private conversation.
  const future = explainDecryptionFailure('SOME_FUTURE_CODE_WE_DO_NOT_HAVE')
  check('an unrecognised code is unknown', future.outlook === 'unknown')
  check('an unrecognised code still says something', future.text.length > 0)
  check('null is unknown, not pending', explainDecryptionFailure(null).outlook === 'unknown')
  check('undefined is unknown, not pending', explainDecryptionFailure(undefined).outlook === 'unknown')
  check('an empty string is unknown', explainDecryptionFailure('').outlook === 'unknown')
  // Unknown must never imply "wait": a spinner that never stops is G-tc06's
  // family, something waiting forever on an event that will not come.
  check('unknown does not imply pending', isDecryptionPending('SOME_FUTURE_CODE') === false)
  check('null does not imply pending', isDecryptionPending(null) === false)
}

console.log('\n-- every explanation is usable copy --')
{
  const OUTLOOKS: DecryptionOutlook[] = ['pending', 'actionable', 'permanent', 'unknown']
  const bad = knownFailureCodes().filter((c) => {
    const e = explainDecryptionFailure(c)
    return !e.text || e.text.length < 10 || !OUTLOOKS.includes(e.outlook)
  })
  check('no code explains itself with an empty or stub string', bad.length === 0, bad)

  // An actionable reason that does not say what to do is not actionable.
  const actionable = knownFailureCodes().filter((c) => explainDecryptionFailure(c).outlook === 'actionable')
  const noInstruction = actionable.filter((c) => {
    const t = explainDecryptionFailure(c).text.toLowerCase()
    return !(t.includes('verify') || t.includes('recovery key') || t.includes('enter'))
  })
  check('every actionable reason tells the user what to do',
    noInstruction.length === 0, noInstruction)
  check('there is at least one actionable reason', actionable.length > 0)
}

console.log('\n-- pending is exactly the retryable set --')
{
  const pending = knownFailureCodes().filter(isDecryptionPending)
  const byOutlook = knownFailureCodes().filter((c) => explainDecryptionFailure(c).outlook === 'pending')
  check('isDecryptionPending agrees with the outlook',
    pending.length === byOutlook.length && pending.every((c) => byOutlook.includes(c)),
    { pending, byOutlook })
  check('permanent reasons are never pending',
    knownFailureCodes()
      .filter((c) => explainDecryptionFailure(c).outlook === 'permanent')
      .every((c) => !isDecryptionPending(c)))
}

console.log('\n-- "there is no decryptor" is not "decryption failed" --')
{
  // The flag-off case, and the reason this distinction exists: with the engine
  // absent nothing ever ATTEMPTED to decrypt, so reporting a failure would
  // describe an event that did not happen and imply a fault where there is
  // only an unshipped feature.
  const off = explainUnreadable('MEGOLM_UNKNOWN_INBOUND_SESSION_ID', false)
  check('crypto unavailable short-circuits every per-code reason',
    off.outlook === 'unavailable', off)
  check('it still says the message is encrypted', off.text.includes('Encrypted'))
  check('it says the limitation is THIS CLIENT, not the message',
    off.text.includes('cannot read encrypted messages'))

  // It must not masquerade as any of the four decryption outcomes.
  check('unavailable is not unknown', explainUnreadable(null, false).outlook !== 'unknown')
  check('unavailable is not permanent', off.outlook !== 'permanent')
  // And nothing may spin on it -- there is no retry that helps (G-tc06).
  check('unavailable never implies pending', isDecryptionPending('MEGOLM_KEY_WITHHELD') === false
    && explainUnreadable(null, false).outlook !== 'pending')

  // With crypto present it must defer to the real reason, unchanged.
  for (const c of knownFailureCodes()) {
    if (explainUnreadable(c, true).outlook !== explainDecryptionFailure(c).outlook) failures++
  }
  check('with crypto available it defers to the per-code explanation',
    knownFailureCodes().every((c) =>
      explainUnreadable(c, true).text === explainDecryptionFailure(c).text))
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
