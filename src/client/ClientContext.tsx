import {
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import * as sdk from 'matrix-js-sdk'
import type { MatrixClient } from 'matrix-js-sdk'
import { saveSession, loadSession, clearSession } from './session'
import { buildClient, deleteSyncStore, startAndWaitForSync } from './buildClient'
import { watchRoomEncryptionConfig } from './roomEncryptionConfig'
import { createTokenRefreshFunction } from './tokenRefresher'
import { ClientContext, type ClientContextValue, type ClientStatus } from './clientContextValue'
import { detail } from './report'
import {
  e2eeEnabled,
  initCrypto,
  observeCryptoIdentity,
  applySilentIdentityAction,
  connectKeyBackup,
} from './crypto'
import type { KeyBackupFacts } from './keyBackup'
import { CRYPTO_LOAD_IDLE, type CryptoLoadState } from './cryptoProgress'
import {
  decideIdentityAction,
  isSilentAction,
  type CryptoIdentityFacts,
  type IdentityAction,
} from './cryptoIdentity'

// MAS redirect target + statically-registered public client id (see mas/config.yaml
// on the remote server). REDIRECT_URI must match the browser's origin and the
// redirect_uri registered for this client in MAS.
const REDIRECT_URI = window.location.origin + '/'
const CLIENT_ID =
  (import.meta.env.VITE_MAS_CLIENT_ID as string | undefined) ?? '00000000000000000000DEVWEB'
const DEFAULT_HOMESERVER =
  (import.meta.env.VITE_HOMESERVER as string | undefined) ?? 'https://41chan.net'





// Hoisted out of the component on purpose. Writing to `window` inside
// ClientProvider is a react-hooks/immutability error under the React Compiler
// (G-tc01): a variable defined outside the component may not be modified from
// within it. The write is identical; only its scope moved.
function exposeForDevConsole(c: MatrixClient) {
  if (import.meta.env.DEV) (window as unknown as { mxClient?: unknown }).mxClient = c
}

// Module-level guard: React StrictMode double-invokes effects in dev, and both
// the OIDC code exchange (single-use code) and resume (avoid two clients) must
// run at most once. Survives a StrictMode remount where component state would not.
let bootstrapStarted = false

export function ClientProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<MatrixClient | null>(null)
  const [status, setStatus] = useState<ClientStatus>('starting')
  const [error, setError] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [cryptoLoad, setCryptoLoad] = useState<CryptoLoadState>(CRYPTO_LOAD_IDLE)
  const [identityAction, setIdentityAction] = useState<IdentityAction | null>(null)
  const [identityFacts, setIdentityFacts] = useState<CryptoIdentityFacts | null>(null)
  const [keyBackup, setKeyBackup] = useState<KeyBackupFacts | null>(null)

  // Shared: build the persistent-store client, sync, and publish it to context.
  const startSyncedClient = async (params: {
    homeserverUrl: string
    accessToken: string
    userId: string
    deviceId?: string
    refreshToken?: string
    tokenRefreshFunction?: sdk.TokenRefreshFunction
  }) => {
    setStatus('syncing')
    const c = await buildClient(params)
    exposeForDevConsole(c)

    // Crypto comes up BETWEEN createClient and startClient -- the SDK requires
    // that order, and it is also the only window with no sync traffic for the
    // progress wrapper to sit in front of. A failure here is reported and
    // stepped past: an unencrypted client is still a working client, and E10
    // says we then tell the truth about it rather than showing a dead shield.
    if (e2eeEnabled()) {
      const up = await initCrypto(c, setCryptoLoad)
      // Identity work only once the engine is actually up. Reading the account
      // through a half-initialised client is how a fresh device concludes that
      // no identity exists (E2).
      if (up) {
        await settleIdentity(c)
        // Connect to an EXISTING backup. Strictly non-destructive: this cannot
        // create or replace a version, and replacing one destroys the keys in
        // the old one (G-e1).
        setKeyBackup(await connectKeyBackup(c))
        // Configure crypto for rooms we join into already-encrypted -- the SDK
        // only does this for encryption events it sees as fresh, which an
        // accepted invite is not. See roomEncryptionConfig.ts.
        watchRoomEncryptionConfig(c)
      }
    }

    setClient(c)
    await startAndWaitForSync(c)
    setStatus('ready')
  }

  // Read the account's encryption identity, decide, and take ONLY the actions
  // that are safe to take without asking (E2).
  //
  // Nothing destructive can happen here: the decision comes from the pure
  // decideIdentityAction, and applySilentIdentityAction refuses anything that
  // is not silent. A decision that needs the user is published as state and
  // waited on -- never acted upon.
  const settleIdentity = async (c: MatrixClient) => {
    const facts = await observeCryptoIdentity(c)
    setIdentityFacts(facts)
    // Null means we could not read the account, which must not be treated as
    // "nothing to do" -- leaving the action null keeps every downstream surface
    // in its honest unknown state (E10).
    if (!facts) return
    const action = decideIdentityAction(facts)
    setIdentityAction(action)
    if (!isSilentAction(action)) return
    await applySilentIdentityAction(c, action)
    // Re-read rather than assume the action worked: bootstrapping can fail
    // server-side, and a client that believes it succeeded shows a shield it
    // has not earned.
    const after = await observeCryptoIdentity(c)
    if (!after) return
    setIdentityFacts(after)
    setIdentityAction(decideIdentityAction(after))
  }

  // Path 1: exchange the MAS authorization code, persist the session, sync.
  async function completeLogin(code: string, state: string) {
    try {
      const result = await sdk.completeAuthorizationCodeGrant(code, state)
      const accessToken = result.tokenResponse.access_token
      const homeserverUrl = result.homeserverUrl

      // Clear ?code&state so a refresh doesn't re-run the (now spent) exchange.
      window.history.replaceState({}, '', REDIRECT_URI)

      const whoamiClient = sdk.createClient({ baseUrl: homeserverUrl, accessToken })
      const whoami = await whoamiClient.whoami()
      const myUserId = whoami.user_id
      const myDeviceId = whoami.device_id ?? ''

      const oidc = {
        issuer: result.oidcClientSettings.issuer,
        clientId: result.oidcClientSettings.clientId,
        redirectUri: REDIRECT_URI,
        idTokenClaims: result.idTokenClaims,
      }
      saveSession({
        homeserverUrl,
        accessToken,
        refreshToken: result.tokenResponse.refresh_token,
        userId: myUserId,
        deviceId: myDeviceId,
        oidc,
      })

      setUserId(myUserId)
      await startSyncedClient({
        homeserverUrl,
        accessToken,
        userId: myUserId,
        deviceId: myDeviceId || undefined,
        refreshToken: result.tokenResponse.refresh_token,
        tokenRefreshFunction: createTokenRefreshFunction({
          issuer: oidc.issuer,
          clientId: oidc.clientId,
          redirectUri: oidc.redirectUri,
          deviceId: myDeviceId,
          idTokenClaims: oidc.idTokenClaims,
        }),
      })
    } catch (err: unknown) {
      console.error('Login failed:', err)
      setError(detail(err))
      setStatus('error')
    }
  }

  // Path 2: rebuild the client from the stored session — no MAS visit.
  async function resumeSession() {
    const s = loadSession()
    if (!s) {
      setStatus('awaiting_login')
      return
    }
    try {
      setUserId(s.userId)
      await startSyncedClient({
        homeserverUrl: s.homeserverUrl,
        accessToken: s.accessToken,
        userId: s.userId,
        deviceId: s.deviceId || undefined,
        refreshToken: s.refreshToken,
        tokenRefreshFunction: createTokenRefreshFunction({
          issuer: s.oidc.issuer,
          clientId: s.oidc.clientId,
          redirectUri: s.oidc.redirectUri,
          deviceId: s.deviceId,
          idTokenClaims: s.oidc.idTokenClaims,
        }),
      })
    } catch (err: unknown) {
      console.error('Resume failed:', err)
      // Refresh also failed (refresh token dead) -> session is truly gone.
      clearSession()
      setUserId(null)
      setStatus('awaiting_login')
    }
  }

  // Begin a fresh login: discover homeserver, build the MAS auth URL, redirect.
  // Boot decision, placed AFTER completeLogin/resumeSession: the React
  // Compiler reads a reference to a value declared later in the component
  // body as use-before-declare, hoisted function or not. Effects run after
  // the whole body regardless, so this position is what the runtime always
  // did -- it is now also what the compiler can see.

  // Bootstrap on mount: finish an in-progress login, resume a stored session,
  // or fall through to awaiting_login.
  useEffect(() => {
    if (bootstrapStarted) return
    bootstrapStarted = true

    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')

    // Deferred one microtask: `setStatus` here would be a synchronous setState
    // in an effect body (G-tc01), and completeLogin/resumeSession are consts
    // declared below this effect, which the compiler reads as use-before-declare
    // even though the body has finished evaluating by the time an effect runs.
    queueMicrotask(() => {
      if (code && state) {
        void completeLogin(code, state)
      } else if (loadSession()) {
        void resumeSession()
      } else {
        setStatus('awaiting_login')
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const login = async (homeserver: string = DEFAULT_HOMESERVER) => {
    try {
      const discovery = await sdk.AutoDiscovery.findClientConfig(homeserver)
      const hsResult = discovery['m.homeserver']
      if (hsResult.state !== 'SUCCESS') {
        throw new Error(`Discovery failed: ${hsResult.state} ${hsResult.error ?? ''}`)
      }
      const baseUrl = hsResult.base_url
      if (!baseUrl) throw new Error('Discovery returned no base URL')

      const tmpClient = sdk.createClient({ baseUrl })
      const authMetadata = await tmpClient.getAuthMetadata()

      const nonce = crypto.randomUUID().replace(/-/g, '')
      const authUrl = await sdk.generateOidcAuthorizationUrl({
        metadata: authMetadata,
        redirectUri: REDIRECT_URI,
        clientId: CLIENT_ID,
        homeserverUrl: baseUrl,
        nonce,
      })
      window.location.href = authUrl
    } catch (err: unknown) {
      console.error('Login start failed:', err)
      setError(detail(err))
      setStatus('error')
    }
  }

  // Stop syncing, drop the session, return to the login screen.
  const logout = () => {
    client?.stopClient()
    // Explicit logout also drops this user's sync cache, so a shared machine
    // does not keep the room list readable after they walk away. Only here:
    // a resume failure (dead refresh token) keeps the cache, because that
    // user coming back is the likely next event. The crypto store is NEVER
    // deleted -- losing device keys is the harm E8 exists to prevent.
    if (userId) deleteSyncStore(userId)
    clearSession()
    setClient(null)
    setUserId(null)
    setStatus('awaiting_login')
  }

  const value: ClientContextValue = {
    client,
    status,
    cryptoLoad,
    identityAction,
    identityFacts,
    keyBackup,
    error,
    userId,
    login,
    logout,
  }

  return <ClientContext.Provider value={value}>{children}</ClientContext.Provider>
}
