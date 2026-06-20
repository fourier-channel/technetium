import { OidcTokenRefresher } from 'matrix-js-sdk'
import type { TokenRefreshFunction } from 'matrix-js-sdk'
import { loadSession, saveSession } from './session'

// Wraps the SDK's OidcTokenRefresher so that whenever the access token is
// refreshed against MAS, the new tokens are written back into our stored
// session. This keeps the persisted session current, so the NEXT reload also
// resumes with a valid token rather than a stale one.
class PersistingOidcTokenRefresher extends OidcTokenRefresher {
  protected async persistTokens(tokens: {
    accessToken: string
    refreshToken?: string
  }): Promise<void> {
    const s = loadSession()
    if (!s) return
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
    // idTokenClaims is typed loosely in our session store; the refresher expects
    // the OIDC IdTokenClaims shape, which is what we persisted from the grant.
    params.idTokenClaims as any,
  )

  return (refreshToken: string) => refresher.doRefreshAccessToken(refreshToken)
}
