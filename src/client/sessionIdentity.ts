// Whether the tokens a browser holds belong to the device it says it is.
//
// The stored session is one record in localStorage shared by every tab of
// this origin. Each tab also holds its own tokens in memory and refreshes them
// against MAS on its own clock. Until 2026-09-10 the refresher wrote the new
// tokens back over whatever record was stored, without asking whose they
// were -- so a tab left open on an older login (device Za3UFulvTE, signed in
// 2026-09-06) kept stamping its tokens onto a record that by then named a
// newer login (device 7pISD02Vsw). A hard refresh of the newer tab then
// resumed with 7p's identity and Za3's token.
//
// That is not cosmetic. Device keys, one-time keys and cross-signing all
// belong to the device the CRYPTO store was built for, while every request
// -- including /sync, which is where to-device room keys arrive -- ran as the
// other device. Room keys sent to 7p queued on a device nobody was polling.
// The panel said "this device is verified" and the server showed the verified
// device idle for an hour. Both were telling the truth about different devices.
//
// Two decisions live here, pure so a check can walk them:
//   * may a refresher persist the tokens it just obtained?  Only into a record
//     that names ITS device. A record naming another device is another tab's,
//     and the right move is to leave it alone.
//   * does the stored session match what the server says the token is?  Asked
//     once at resume, before crypto is brought up on the wrong identity.

export type PersistVerdict =
  // The stored record names this refresher's device: write the tokens.
  | 'persist'
  // Nothing stored (signed out meanwhile): nothing to update.
  | 'no-session'
  // The record names a different device. Another tab's login owns it now.
  | 'foreign-device'

export function persistVerdict(
  stored: { deviceId: string } | null,
  refresherDeviceId: string,
): PersistVerdict {
  if (!stored) return 'no-session'
  return stored.deviceId === refresherDeviceId ? 'persist' : 'foreign-device'
}

export type DeviceMatch =
  // whoami named the device the session names.
  | 'match'
  // whoami named a different device: the token is not this identity's.
  | 'mismatch'
  // whoami carried no device (a guest or an appservice token); nothing to
  // compare, so the session is taken at its word rather than thrown away.
  | 'unknown'

export function compareDevice(storedDeviceId: string, whoamiDeviceId: string | undefined): DeviceMatch {
  if (!whoamiDeviceId) return 'unknown'
  return storedDeviceId === whoamiDeviceId ? 'match' : 'mismatch'
}

// Thrown by resume when the stored tokens turn out to be another device's.
// Carries both ids so the message can say which, and so the catch can tell
// this apart from a dead refresh token without string-matching.
export class ForeignTokensError extends Error {
  readonly storedDeviceId: string
  readonly actualDeviceId: string
  constructor(storedDeviceId: string, actualDeviceId: string) {
    super(describeForeignTokens(storedDeviceId, actualDeviceId))
    this.name = 'ForeignTokensError'
    this.storedDeviceId = storedDeviceId
    this.actualDeviceId = actualDeviceId
  }
}

export function describeForeignTokens(storedDeviceId: string, actualDeviceId: string): string {
  return (
    `This browser remembered session ${storedDeviceId} but was holding the sign-in of ` +
    `session ${actualDeviceId}, which another tab of Technetium is still using. ` +
    'Both were signed out of this tab so they cannot be mixed up again. ' +
    'Close any other Technetium tabs, then sign in again.'
  )
}
