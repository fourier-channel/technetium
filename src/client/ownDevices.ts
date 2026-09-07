// This account's own devices, and how far each one is trusted.
//
// Read-only. Listing your devices must never change any of them, which is not
// a hypothetical caution here: the neighbouring backup call enables as a side
// effect of asking, and this module deliberately does not repeat that shape.
import type { MatrixClient } from 'matrix-js-sdk'

export interface OwnDevice {
  deviceId: string
  displayName: string | null
  // The one you are reading this on. It cannot verify itself, so the UI must
  // treat it differently from the others.
  isThisDevice: boolean
  // Signed by this account's own cross-signing identity: the meaningful sense
  // of "verified" for someone else looking at you.
  crossSigningVerified: boolean
  // Verified by hand on this device only. Real trust, but it travels nowhere.
  locallyVerified: boolean
}

export async function observeOwnDevices(client: MatrixClient): Promise<OwnDevice[] | null> {
  const crypto = client.getCrypto()
  const userId = client.getUserId()
  const thisDevice = client.getDeviceId()
  if (!crypto || !userId) return null
  try {
    // downloadUncached: the server's answer, not a local cache that is empty on
    // a fresh device -- the same trap observeCryptoIdentity guards against,
    // where an empty cache reads as "you have no other devices" and walks the
    // user toward the destructive branch.
    const map = await crypto.getUserDeviceInfo([userId], true)
    const mine = map.get(userId)
    // Our own user missing from our own query is a FAILED observation, not an
    // empty list. Answering null says "unknown"; answering [] would say "you
    // have nothing to verify against".
    if (!mine) return null

    const out: OwnDevice[] = []
    for (const [deviceId, device] of mine) {
      const status = await crypto.getDeviceVerificationStatus(userId, deviceId)
      out.push({
        deviceId,
        displayName: device.displayName ?? null,
        isThisDevice: deviceId === thisDevice,
        crossSigningVerified: status?.crossSigningVerified ?? false,
        locallyVerified: status?.localVerified ?? false,
      })
    }
    // This device first, then unverified ones -- the list is read to find
    // something to act on, and the things needing action belong at the top.
    return out.sort((a, b) => {
      if (a.isThisDevice !== b.isThisDevice) return a.isThisDevice ? -1 : 1
      const av = a.crossSigningVerified || a.locallyVerified
      const bv = b.crossSigningVerified || b.locallyVerified
      if (av !== bv) return av ? 1 : -1
      return a.deviceId.localeCompare(b.deviceId)
    })
  } catch (err) {
    console.error('[crypto] could not read this account\'s devices', err)
    return null
  }
}

// What the list means as one sentence, for a panel that must not imply a
// device is trusted when it is only trusted here.
export function deviceTrustLabel(d: OwnDevice): string {
  if (d.crossSigningVerified) return 'verified'
  if (d.locallyVerified) return 'verified on this device only'
  return 'not verified'
}
