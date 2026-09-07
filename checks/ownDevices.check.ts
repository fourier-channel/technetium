// The device list's labelling. A panel that calls a device "verified" when it
// is only trusted on this machine tells the user something other people cannot
// see, which is the difference between cross-signing and a local mark.
import { deviceTrustLabel, type OwnDevice } from '../src/client/ownDevices'

let failures = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name + (extra === undefined ? '' : ' -- ' + JSON.stringify(extra))) }
}
const dev = (o: Partial<OwnDevice> = {}): OwnDevice => ({
  deviceId: 'AAA', displayName: null, isThisDevice: false,
  crossSigningVerified: false, locallyVerified: false, ...o,
})

check('cross-signed reads as verified', deviceTrustLabel(dev({ crossSigningVerified: true })) === 'verified')
check('locally-only says so, rather than claiming verified',
  deviceTrustLabel(dev({ locallyVerified: true })) === 'verified on this device only')
check('neither is not verified', deviceTrustLabel(dev()) === 'not verified')
check('cross-signing wins when both are true',
  deviceTrustLabel(dev({ crossSigningVerified: true, locallyVerified: true })) === 'verified')

// The one that matters: no state may produce the bare word "verified" unless
// the trust is one other people can actually see.
{
  let wrong = 0
  for (const cs of [true, false]) for (const local of [true, false]) {
    const label = deviceTrustLabel(dev({ crossSigningVerified: cs, locallyVerified: local }))
    if (label === 'verified' && !cs) wrong++
  }
  check('nothing is called plainly "verified" without cross-signing', wrong === 0, wrong)
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
