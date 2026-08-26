// Checks for what the client is allowed to claim about a room's privacy.
//
// This is the E10 law as a test. A padlock is cheap to draw and enormously
// expensive to be wrong about: someone who believes a conversation is
// end-to-end encrypted will say things in it they would not otherwise say.
//
// So the properties below are exhaustive, and the central one is not "the
// shield renders correctly" but "the client never claims privacy it could not
// verify".
import {
  roomShieldState,
  claimsPrivacy,
  shieldCopy,
  type RoomShieldFacts,
  type ShieldState,
} from '../src/client/roomShield.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const ALL: RoomShieldFacts[] = []
for (const roomIsEncrypted of [false, true])
  for (const cryptoAvailable of [false, true])
    for (const membersWithoutCrypto of [0, 1, 3])
      for (const unverifiedDevices of [0, 1, 4])
        ALL.push({ roomIsEncrypted, cryptoAvailable, membersWithoutCrypto, unverifiedDevices })

const show = (f: RoomShieldFacts) => JSON.stringify(f)

console.log(`\n-- the law, over all ${ALL.length} states --`)
{
  // THE property. Everything else is presentation.
  const claimedWithoutCrypto = ALL.filter((f) => claimsPrivacy(roomShieldState(f)) && !f.cryptoAvailable)
  check('privacy is never claimed while crypto is unavailable',
    claimedWithoutCrypto.length === 0, claimedWithoutCrypto.map(show))

  const claimedUnencrypted = ALL.filter((f) => claimsPrivacy(roomShieldState(f)) && !f.roomIsEncrypted)
  check('privacy is never claimed for an unencrypted room',
    claimedUnencrypted.length === 0, claimedUnencrypted.map(show))

  // The inverse failure is real too: a client so cautious it never affirms
  // anything trains users to ignore the indicator entirely.
  const perfect = ALL.filter(
    (f) => f.roomIsEncrypted && f.cryptoAvailable && f.membersWithoutCrypto === 0 && f.unverifiedDevices === 0,
  )
  check('a genuinely private room IS affirmed',
    perfect.every((f) => roomShieldState(f) === 'encrypted'), perfect.map(show))
}

console.log('\n-- an unverifiable room is not a private one and not a public one --')
{
  // The state that exists because the honest answer is neither yes nor no. A
  // room marked encrypted that we cannot decrypt, check, or tell working from
  // broken.
  const f: RoomShieldFacts = {
    roomIsEncrypted: true, cryptoAvailable: false, membersWithoutCrypto: 0, unverifiedDevices: 0,
  }
  check('it is unverifiable, not encrypted', roomShieldState(f) === 'unverifiable')
  check('it does not claim privacy', claimsPrivacy(roomShieldState(f)) === false)
  // And it must not be reported as plainly unencrypted either -- that is a
  // different, also-false claim, and would tell the user the server can read
  // messages the server in fact cannot.
  check('it is not reported as not-encrypted', roomShieldState(f) !== 'not-encrypted')
  check('its copy tells the user not to rely on this device',
    shieldCopy(f).detail.toLowerCase().includes('do not treat it as private'))
}

console.log('\n-- warnings stay distinguishable from each other --')
{
  const gap: RoomShieldFacts = {
    roomIsEncrypted: true, cryptoAvailable: true, membersWithoutCrypto: 2, unverifiedDevices: 0,
  }
  const unver: RoomShieldFacts = {
    roomIsEncrypted: true, cryptoAvailable: true, membersWithoutCrypto: 0, unverifiedDevices: 2,
  }
  check('a participant who cannot read warns', roomShieldState(gap) === 'encrypted-warning')
  check('an unverified device warns', roomShieldState(unver) === 'encrypted-warning')
  // Same state, different meanings. One says somebody cannot read you; the
  // other says somebody might not be who you think. A generic caution loses
  // the only thing the user could act on.
  check('the two warnings do not share copy', shieldCopy(gap).detail !== shieldCopy(unver).detail)
  check('the gap warning says they will not see messages',
    shieldCopy(gap).detail.includes('will not see'))
  check('the unverified warning still permits sending (O-e5)',
    shieldCopy(unver).detail.toLowerCase().includes('can still send'))
  // A warned room is still encrypted -- warning is not a downgrade to public.
  check('a warned room still counts as private', claimsPrivacy(roomShieldState(gap)) === true)
}

console.log('\n-- plurals, because a badge that says "1 devices" is not trusted --')
{
  const one = shieldCopy({ roomIsEncrypted: true, cryptoAvailable: true, membersWithoutCrypto: 0, unverifiedDevices: 1 })
  const many = shieldCopy({ roomIsEncrypted: true, cryptoAvailable: true, membersWithoutCrypto: 0, unverifiedDevices: 4 })
  check('one device reads singular',
    one.detail.includes('1 device in') && one.detail.includes('has not been verified')
      && !one.detail.includes('devices'), one.detail)
  check('several devices read plural',
    many.detail.includes('4 devices in') && many.detail.includes('have not been verified'),
    many.detail)
  const oneM = shieldCopy({ roomIsEncrypted: true, cryptoAvailable: true, membersWithoutCrypto: 1, unverifiedDevices: 0 })
  check('one participant reads singular', oneM.detail.includes('1 participant cannot'))
}

console.log('\n-- every state has usable copy, and only the right ones claim privacy --')
{
  const STATES: ShieldState[] = ['encrypted', 'encrypted-warning', 'not-encrypted', 'unverifiable']
  check('exactly two states claim privacy',
    STATES.filter(claimsPrivacy).length === 2)
  const bad = ALL.filter((f) => {
    const c = shieldCopy(f)
    return !c.label || !c.detail || c.detail.length < 20
  })
  check('no state renders an empty or stub badge', bad.length === 0, bad.map(show))
  // An unencrypted content room is normal, not an alarm -- this client's whole
  // design is that content rooms are public by intent.
  const plain = shieldCopy({ roomIsEncrypted: false, cryptoAvailable: true, membersWithoutCrypto: 0, unverifiedDevices: 0 })
  check('an unencrypted room is described as intended, not as a fault',
    plain.detail.includes('how content rooms are meant to work'))
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
