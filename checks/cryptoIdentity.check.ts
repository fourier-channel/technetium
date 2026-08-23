// Checks for the cross-signing identity decision.
//
// This file is the reason cryptoIdentity.ts is a pure module. The failure it
// guards is not a wrong label on a dialog -- it is a client that calls
// bootstrapCrossSigning with setupNewCrossSigning against an account that
// already has an identity, replacing working credentials and orphaning every
// key in the user's backup (D-e1), with the backing store genuinely destroyed
// on deletion (G-e1).
//
// So the important assertions here are EXHAUSTIVE over the input space, not
// example-based. An example test proves the case you thought of; the property
// tests below prove the ones you did not.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import {
  decideIdentityAction,
  resetPermitted,
  isSilentAction,
  identityActionCopy,
  canReadExistingHistory,
  atRiskOfKeyLoss,
  type CryptoIdentityFacts,
  type IdentityAction,
} from '../src/client/cryptoIdentity.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

// Every combination of the boolean facts, crossed with a backup that is present
// or absent and a device count of none / one / many. 2^4 * 2 * 3 = 96 states,
// which is the entire input space this function can ever see.
const ALL: CryptoIdentityFacts[] = []
for (const accountHasIdentity of [false, true])
  for (const privateKeysOnThisDevice of [false, true])
    for (const privateKeysInSecretStorage of [false, true])
      for (const thisDeviceVerified of [false, true])
        for (const keyBackupVersion of [null, '3'])
          for (const otherDeviceCount of [0, 1, 7])
            ALL.push({
              accountHasIdentity,
              privateKeysOnThisDevice,
              privateKeysInSecretStorage,
              thisDeviceVerified,
              keyBackupVersion,
              otherDeviceCount,
            })

const describe = (f: CryptoIdentityFacts) => JSON.stringify(f)

console.log(`\n-- the safety properties, over all ${ALL.length} reachable states --`)
{
  // THE property. A reset is the one irreversible act in this client.
  const wrongfulReset = ALL.filter(
    (f) => resetPermitted(decideIdentityAction(f)) && decideIdentityAction(f) !== 'reset-required',
  )
  check('a reset is permitted for exactly one decision',
    wrongfulReset.length === 0, wrongfulReset.map(describe))

  // The corollary that actually protects users: reset is unreachable while any
  // non-destructive route exists.
  const resettableWithRouteLeft = ALL.filter((f) => {
    if (decideIdentityAction(f) !== 'reset-required') return false
    return f.privateKeysOnThisDevice || f.privateKeysInSecretStorage || f.otherDeviceCount > 0
  })
  check('reset is never reached while a non-destructive route remains',
    resettableWithRouteLeft.length === 0, resettableWithRouteLeft.map(describe))

  // Creating an identity is safe ONLY when there is none. Anywhere else it is
  // the destructive act wearing the word "setup".
  const createsOverExisting = ALL.filter(
    (f) => f.accountHasIdentity && decideIdentityAction(f) === 'bootstrap-new',
  )
  check('an identity is never created over an existing one',
    createsOverExisting.length === 0, createsOverExisting.map(describe))

  // And the converse: an account with nothing must never be sent down a
  // recovery or verification path, which would strand a new user at a prompt
  // for a key that does not exist.
  const recoversFromNothing = ALL.filter(
    (f) => !f.accountHasIdentity && decideIdentityAction(f) !== 'bootstrap-new',
  )
  check('an account with no identity always simply creates one',
    recoversFromNothing.length === 0, recoversFromNothing.map(describe))

  // Reset must never be permitted for an account that has nothing to reset.
  const resetsNothing = ALL.filter(
    (f) => !f.accountHasIdentity && resetPermitted(decideIdentityAction(f)),
  )
  check('reset is never permitted for an account with no identity',
    resetsNothing.length === 0, resetsNothing.map(describe))
}

console.log('\n-- every state decides, and only into known actions --')
{
  const KNOWN: IdentityAction[] = [
    'ready', 'bootstrap-new', 'adopt-existing',
    'recover-from-secret-storage', 'verify-with-other-device', 'reset-required',
  ]
  const unknown = ALL.filter((f) => !KNOWN.includes(decideIdentityAction(f)))
  check('no state falls through to undefined', unknown.length === 0, unknown.map(describe))

  // A decision with no copy is a dialog with a blank body.
  const uncopied = KNOWN.filter((a) => {
    const c = identityActionCopy(a)
    return !c || !c.title || !c.detail
  })
  check('every action has a title and a detail', uncopied.length === 0, uncopied)
}

console.log('\n-- the ordering that makes the algorithm safe --')
{
  const base: CryptoIdentityFacts = {
    accountHasIdentity: true,
    privateKeysOnThisDevice: false,
    privateKeysInSecretStorage: false,
    thisDeviceVerified: false,
    keyBackupVersion: '1',
    otherDeviceCount: 0,
  }
  check('keys already here, device signed -> nothing to do',
    decideIdentityAction({ ...base, privateKeysOnThisDevice: true, thisDeviceVerified: true }) === 'ready')
  check('keys already here, device unsigned -> adopt, never create',
    decideIdentityAction({ ...base, privateKeysOnThisDevice: true }) === 'adopt-existing')
  check('keys in secret storage -> ask for the recovery key',
    decideIdentityAction({ ...base, privateKeysInSecretStorage: true }) === 'recover-from-secret-storage')
  check('no keys reachable but another device exists -> verify',
    decideIdentityAction({ ...base, otherDeviceCount: 1 }) === 'verify-with-other-device')
  check('nothing reachable and nothing to ask -> reset, and only then',
    decideIdentityAction(base) === 'reset-required')
  // Secret storage outranks a device: a recovery key always works, whereas a
  // second device has to be present and awake.
  check('secret storage is preferred over device verification',
    decideIdentityAction({ ...base, privateKeysInSecretStorage: true, otherDeviceCount: 9 })
      === 'recover-from-secret-storage')
}

console.log('\n-- silent actions are exactly the non-destructive ones --')
{
  const silentButDestructive = (['reset-required'] as IdentityAction[]).filter(isSilentAction)
  check('a reset is never silent', silentButDestructive.length === 0, silentButDestructive)

  const needsUserButSilent = (['recover-from-secret-storage', 'verify-with-other-device'] as IdentityAction[])
    .filter(isSilentAction)
  check('anything needing the user is not silent', needsUserButSilent.length === 0, needsUserButSilent)

  check('creating is silent', isSilentAction('bootstrap-new'))
  check('adopting is silent', isSilentAction('adopt-existing'))
}

console.log('\n-- reading history is a different claim from encryption working --')
{
  const f = (over: Partial<CryptoIdentityFacts>): CryptoIdentityFacts => ({
    accountHasIdentity: true,
    privateKeysOnThisDevice: false,
    privateKeysInSecretStorage: false,
    thisDeviceVerified: false,
    keyBackupVersion: null,
    otherDeviceCount: 0,
    ...over,
  })
  // The state this exists for: a device that can send but cannot read a word of
  // the past. Telling that user "encryption is on" is the false reassurance
  // E10 forbids.
  check('an unverified device cannot read history',
    canReadExistingHistory(f({ privateKeysOnThisDevice: true, thisDeviceVerified: false })) === false)
  check('keys in secret storage are not the same as keys here',
    canReadExistingHistory(f({ privateKeysInSecretStorage: true })) === false)
  check('a verified device with its keys can read',
    canReadExistingHistory(f({ privateKeysOnThisDevice: true, thisDeviceVerified: true })) === true)
  check('a brand new account has nothing it cannot read',
    canReadExistingHistory(f({ accountHasIdentity: false })) === true)

  // Every state that can read history must also be one where nothing is being
  // asked of the user -- otherwise we are prompting someone who is already fine.
  const readableButPrompting = ALL.filter(
    (x) => canReadExistingHistory(x) && x.accountHasIdentity && !isSilentAction(decideIdentityAction(x)),
  )
  check('a device that can read history is never prompted',
    readableButPrompting.length === 0, readableButPrompting.map(describe))
}

console.log('\n-- the key-loss warning fires while the device still exists --')
{
  const noBackup = ALL.filter((x) => x.accountHasIdentity && x.keyBackupVersion === null)
  check('every identity without a backup is flagged at risk',
    noBackup.every(atRiskOfKeyLoss), noBackup.filter((x) => !atRiskOfKeyLoss(x)).map(describe))
  const withBackup = ALL.filter((x) => x.keyBackupVersion !== null)
  check('a live backup is never flagged at risk',
    withBackup.every((x) => !atRiskOfKeyLoss(x)))
  const noIdentity = ALL.filter((x) => !x.accountHasIdentity)
  check('an account with no encryption is not warned about losing it',
    noIdentity.every((x) => !atRiskOfKeyLoss(x)))
}

console.log('\n-- the destructive flag exists in exactly one place --')
{
  // A source-level guard, not a behavioural one. `setupNewCrossSigning` is the
  // single SDK option that can destroy an identity, and the boot path must
  // never be able to pass it -- not "passes false", but cannot mention it at
  // all, so that a future edit flipping a boolean is impossible rather than
  // merely unlikely. When E11 lands, the reset module is the ONE file allowed
  // to appear in this list.
  // Every SDK call that destroys keys, not just the cross-signing one.
  // resetKeyBackup REPLACES an existing backup, and replacing one deletes the
  // keys in the old version (G-e1) -- so it belongs behind the same gate.
  const DESTRUCTIVE = ['setupNewCrossSigning', 'resetKeyBackup', 'deleteKeyBackupVersion', 'disableKeyStorage']
  const ALLOWED = ['src/client/cryptoReset.ts']
  const roots = ['src/client', 'src/ui', 'src/onboarding', 'src/App.tsx', 'src/main.tsx']
  const offenders: string[] = []
  const walk = (p: string) => {
    const st = statSync(p, { throwIfNoEntry: false })
    if (!st) return
    if (st.isDirectory()) { for (const e of readdirSync(p)) walk(p + '/' + e); return }
    if (!/\.tsx?$/.test(p) || ALLOWED.includes(p)) return
    const src = readFileSync(p, 'utf8')
    for (const d of DESTRUCTIVE) if (src.includes(d)) offenders.push(`${p} :: ${d}`)
  }
  roots.forEach(walk)
  check('no non-reset module can name a key-destroying call',
    offenders.length === 0, offenders)
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
