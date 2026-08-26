// Checks for whether a new DM is created encrypted.
//
// The failure guarded here is total and silent: encrypt a room with a
// participant who has no crypto and one side sends into the void while the
// other receives nothing it can read, with no error on either end. On this
// network that participant is the bridge bot people are onboarded through, so
// getting this wrong breaks the way new users arrive.
//
// The properties are asserted over the whole input space, because the
// interesting states are the ones nobody writes an example for -- a failed
// lookup, a negative count, crypto down while the recipient is fine.
import { readFileSync } from 'node:fs'
import {
  decideDmEncryption,
  willEncrypt,
  dmEncryptionNotice,
  ENCRYPTED_DM_MEDIA_NOTICE,
  type DmEncryptionFacts,
  type DmEncryptionDecision,
} from '../src/client/dmEncryption.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const ALL: DmEncryptionFacts[] = []
for (const cryptoAvailable of [false, true])
  for (const recipientDevicesKnown of [false, true])
    // -1 is not paranoia: a subtraction elsewhere producing a negative must not
    // read as "has devices".
    for (const recipientDeviceCount of [-1, 0, 1, 5])
      ALL.push({ cryptoAvailable, recipientDevicesKnown, recipientDeviceCount })

const show = (f: DmEncryptionFacts) => JSON.stringify(f)

console.log(`\n-- the safety property, over all ${ALL.length} states --`)
{
  // THE property (D-e4). Everything else in this file is detail.
  const encryptedToNobody = ALL.filter(
    (f) => willEncrypt(decideDmEncryption(f)) && f.recipientDeviceCount <= 0,
  )
  check('never encrypts to a party with no devices',
    encryptedToNobody.length === 0, encryptedToNobody.map(show))

  const encryptedWhileBlind = ALL.filter(
    (f) => willEncrypt(decideDmEncryption(f)) && !f.recipientDevicesKnown,
  )
  check('never encrypts on a failed lookup',
    encryptedWhileBlind.length === 0, encryptedWhileBlind.map(show))

  const encryptedWithoutCrypto = ALL.filter(
    (f) => willEncrypt(decideDmEncryption(f)) && !f.cryptoAvailable,
  )
  check('never encrypts without a working engine',
    encryptedWithoutCrypto.length === 0, encryptedWithoutCrypto.map(show))

  // The converse: it must not be so cautious that it never encrypts anything.
  // A guard that always says no is indistinguishable from the feature being off.
  const good = ALL.filter((f) => f.cryptoAvailable && f.recipientDevicesKnown && f.recipientDeviceCount > 0)
  check('always encrypts when everything is in order',
    good.every((f) => willEncrypt(decideDmEncryption(f))), good.filter((f) => !willEncrypt(decideDmEncryption(f))).map(show))
}

console.log('\n-- unknown is its own answer, not a quiet no --')
{
  // Collapsing "we could not ask" into "they have no keys" would silently
  // downgrade a real user's DM to plaintext and present it as a capability
  // decision -- a different, and wrong, sentence to show them.
  const blind: DmEncryptionFacts = { cryptoAvailable: true, recipientDevicesKnown: false, recipientDeviceCount: 0 }
  check('a failed lookup is distinguishable from a bot',
    decideDmEncryption(blind) === 'plaintext-unknown-recipient')
  const bot: DmEncryptionFacts = { cryptoAvailable: true, recipientDevicesKnown: true, recipientDeviceCount: 0 }
  check('a party with genuinely no devices reads as cannot-receive',
    decideDmEncryption(bot) === 'plaintext-recipient-cannot')
  check('the two produce different notices',
    dmEncryptionNotice(decideDmEncryption(blind)) !== dmEncryptionNotice(decideDmEncryption(bot)))
}

console.log('\n-- our own failure outranks theirs --')
{
  // If our engine is down, their capability is irrelevant and saying anything
  // about them is a distraction from the fact that WE are the problem.
  const f: DmEncryptionFacts = { cryptoAvailable: false, recipientDevicesKnown: true, recipientDeviceCount: 9 }
  check('no crypto reports no crypto, not a recipient problem',
    decideDmEncryption(f) === 'plaintext-no-crypto')
}

console.log('\n-- every outcome says something, and only one claims privacy --')
{
  const ALL_DECISIONS: DmEncryptionDecision[] = [
    'encrypt', 'plaintext-no-crypto', 'plaintext-recipient-cannot', 'plaintext-unknown-recipient',
  ]
  const silent = ALL_DECISIONS.filter((d) => !dmEncryptionNotice(d) || dmEncryptionNotice(d).length < 20)
  check('no outcome is silent', silent.length === 0, silent)

  // A DM quietly not encrypted, in a client that advertises encrypted DMs, is
  // exactly the false guarantee E10 forbids. Every plaintext outcome must SAY
  // it is not encrypted.
  const plaintext = ALL_DECISIONS.filter((d) => d !== 'encrypt')
  const notSaying = plaintext.filter((d) => !dmEncryptionNotice(d).includes('NOT encrypted'))
  check('every plaintext outcome states plainly that it is not encrypted',
    notSaying.length === 0, notSaying)

  const claimsPrivacy = ALL_DECISIONS.filter((d) =>
    dmEncryptionNotice(d).toLowerCase().includes('end-to-end encrypted'))
  check('exactly one outcome claims end-to-end encryption',
    claimsPrivacy.length === 1 && claimsPrivacy[0] === 'encrypt', claimsPrivacy)
}

console.log('\n-- the media disclosure is the ruled wording (D-e3) --')
{
  check('it says the media stays here',
    ENCRYPTED_DM_MEDIA_NOTICE.includes('stays here'))
  check('it names both halves of what does not happen',
    ENCRYPTED_DM_MEDIA_NOTICE.includes('Nothing is tagged')
      && ENCRYPTED_DM_MEDIA_NOTICE.includes('nothing is posted to chanbooru'))
}

console.log('\n-- the algorithm we create rooms with is the one the SDK declares --')
{
  // dm.ts imports the SDK at runtime so the harness cannot load it; the source
  // is read as text instead. The literal is the single thing that decides
  // whether a room we create is encrypted the way every other client expects,
  // and it is a magic string on both sides -- so it gets compared rather than
  // trusted (D-tc01).
  const dmSrc = readFileSync('src/client/dm.ts', 'utf8')
  const sdkSrc = readFileSync('node_modules/matrix-js-sdk/lib/@types/state_events.d.ts', 'utf8')
  const sdkAlgo = sdkSrc.match(/"algorithm":\s*"([^"]+)"/)?.[1] ?? null
  check('the SDK still declares an encryption algorithm literal', sdkAlgo !== null, sdkAlgo)
  check('dm.ts creates rooms with exactly that algorithm',
    sdkAlgo !== null && dmSrc.includes(`algorithm: '${sdkAlgo}'`), sdkAlgo)

  // The room must be encrypted AS IT IS CREATED. Adding the state event
  // afterwards leaves the invite, and any racing first message, in the clear.
  check('encryption is passed as initial_state, not sent afterwards',
    dmSrc.includes('initial_state') && !/setRoomEncryption|sendStateEvent\(/.test(dmSrc))

  // D-e5: an existing conversation is never silently upgraded. Scoped to the
  // function body -- the naive whole-file search matches the import line and
  // passes for the wrong reason.
  const body = dmSrc.slice(dmSrc.indexOf('export async function startDm'))
  check('startDm was found', body.length > 0)
  check('startDm returns an existing room BEFORE deciding any encryption',
    body.indexOf('if (existing) return') > 0
      && body.indexOf('if (existing) return') < body.indexOf('decideDmEncryption'),
    { earlyReturn: body.indexOf('if (existing) return'), decide: body.indexOf('decideDmEncryption') })
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
