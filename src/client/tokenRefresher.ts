import { OidcTokenRefresher } from 'matrix-js-sdk'
import type { TokenRefreshFunction } from 'matrix-js-sdk'
import type { IdTokenClaims } from 'oidc-client-ts'
import { loadSession, saveSession } from './session'
import { persistVerdict } from './sessionIdentity'
import { reportIgnored } from './report'

// Wraps the SDK's OidcTokenRefresher so that whenever the access token is
// refreshed against MAS, the new tokens are written back into our stored
// session. This keeps the persisted session current, so the NEXT reload also
// resumes with a valid token rather than a stale one.
//
// It writes ONLY into a record that names its own device. The record is shared
// by every tab of this origin, and a tab left open on an older login refreshes
// on its own clock: without this guard it stamped its tokens over a newer
// login's record, and the newer tab resumed as one device carrying another's
// token. See sessionIdentity.ts for what that broke.
class PersistingOidcTokenRefresher extends OidcTokenRefresher {
  private readonly ownDeviceId: string

  constructor(
    issuer: string,
    clientId: string,
    redirectUri: string,
    ownDeviceId: string,
    idTokenClaims: IdTokenClaims,
  ) {
    super(issuer, clientId, redirectUri, ownDeviceId, idTokenClaims)
    this.ownDeviceId = ownDeviceId
  }

  protected async persistTokens(tokens: {
    accessToken: string
    refreshToken?: string
  }): Promise<void> {
    const s = loadSession()
    const verdict = persistVerdict(s, this.ownDeviceId)
    if (verdict !== 'persist' || !s) {
      if (verdict === 'foreign-device') {
        reportIgnored(
          'token refresh: stored session belongs to another device',
          new Error(`stored ${s?.deviceId} refresher ${this.ownDeviceId}`),
        )
      }
      return
    }
    saveSession({
      ...s,
      accessToken: tokens.accessToken,
      // MAS may or may not rotate the refresh token; keep the old one if absent.
      refreshToken: tokens.refreshToken ?? s.refreshToken,
    })
    console.log('Token refreshed and session updated')
  }
}

export interface RefresherParams {
  issuer: string
  clientId: string
  redirectUri: string
  deviceId: string
  idTokenClaims: unknown
}

// Builds the tokenRefreshFunction passed to createClient. The SDK calls this
// with the current refresh token whenever it gets a 401 from an expired access
// token; we hand back fresh tokens (and persistTokens above saves them).
export function createTokenRefreshFunction(
  params: RefresherParams,
): TokenRefreshFunction {
  const refresher = new PersistingOidcTokenRefresher(
    params.issuer,
    params.clientId,
    params.redirectUri,
    params.deviceId,
    // idTokenClaims is stored as `unknown` (the session store does not model
    // the OIDC claim set); the refresher wants IdTokenClaims, which is exactly
    // what we persisted from the grant. Narrowed through the SDK's own type
    // rather than `any`, so a future signature change is a compile error.
    params.idTokenClaims as IdTokenClaims,
  )

  return (refreshToken: string) => refresher.doRefreshAccessToken(refreshToken)
}
