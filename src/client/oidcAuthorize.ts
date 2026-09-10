// The authorization URL for login, with the scopes THIS client needs.
//
// The SDK's generateOidcAuthorizationUrl hardcodes its scope: openid, the
// client API, and a device. There is no option to add one, and the session
// management in the Settings panel needs MAS's GraphQL scope on the access
// token (masSessions.ts). So the URL is built here, the way the SDK builds
// it -- same state store, same prefix, same user-state shape -- so that the
// SDK's completeAuthorizationCodeGrant still finishes the login untouched.
//
// Refresh keeps the scope: MAS 1.22 issues refreshed tokens with the
// session's original scope and never reads a scope parameter on the refresh
// grant, and the SDK's refresher sends none. Verified against the source
// before this was written, because a scope that silently fell off at the
// first refresh five minutes after login would be a feature that worked
// only in the demo.
import { OidcClient, WebStorageStateStore } from 'oidc-client-ts'
import { generateScope } from 'matrix-js-sdk'
import type { OidcClientConfig } from 'matrix-js-sdk'

// Named, so a check can hold the login to requesting it.
export const MAS_GRAPHQL_SCOPE = 'urn:mas:graphql:*'

export function loginScope(): string {
  return `${generateScope()} ${MAS_GRAPHQL_SCOPE}`
}

// Whether a token was issued with the GraphQL scope. The token response
// carries the granted scope; a login from before this change did not have it.
export function hasGraphqlScope(scope: string | undefined): boolean {
  return !!scope && scope.split(' ').includes(MAS_GRAPHQL_SCOPE)
}

export async function generateLoginUrl(opts: {
  metadata: OidcClientConfig
  redirectUri: string
  clientId: string
  homeserverUrl: string
  nonce: string
}): Promise<string> {
  const client = new OidcClient({
    ...opts.metadata,
    // The SDK's validated metadata says null where oidc-client-ts wants
    // undefined; the SDK itself papers over the same gap.
    signingKeys: opts.metadata.signingKeys ?? undefined,
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    authority: opts.metadata.issuer,
    response_mode: 'query',
    response_type: 'code',
    scope: loginScope(),
    // Exactly the SDK's store, or completeAuthorizationCodeGrant cannot find
    // the state it needs to finish.
    stateStore: new WebStorageStateStore({ prefix: 'mx_oidc_', store: window.sessionStorage }),
  })
  const request = await client.createSigninRequest({
    state: { homeserverUrl: opts.homeserverUrl, nonce: opts.nonce },
    nonce: opts.nonce,
  })
  return request.url
}
