import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import * as sdk from 'matrix-js-sdk'
import type { MatrixClient } from 'matrix-js-sdk'
import { saveSession, loadSession, clearSession } from './session'
import { buildClient, startAndWaitForSync } from './buildClient'
import { createTokenRefreshFunction } from './tokenRefresher'
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

// Lifecycle of the client, so the UI can render the right thing per phase.
export type ClientStatus =
  | 'starting' // bootstrap in progress (deciding which path)
  | 'awaiting_login' // no session — show the login UI
  | 'syncing' // client built, initial sync running
  | 'ready' // synced and usable
  | 'error'

interface ClientContextValue {
  client: MatrixClient | null
  status: ClientStatus
  error: string | null
  userId: string | null
  // How the crypto engine's arrival is going, so the shell can show it (D-e6).
  // Stays 'idle' for everyone while the flag is off.
  cryptoLoad: CryptoLoadState
  // What this account's encryption identity needs, if anything. Null until
  // crypto is up, or when we could not read it -- which is NOT the same as
  // "nothing needed", and callers must not collapse the two.
  identityAction: IdentityAction | null
  // The facts behind that decision, for surfaces that need more than the verb
  // (whether history is readable, whether a backup exists).
  identityFacts: CryptoIdentityFacts | null
  // Whether this account's conversations would survive losing this device
  // (E8). Null means we could not find out -- which callers must NOT render as
  // "no backup", since that tells a protected user they are at risk.
  keyBackup: KeyBackupFacts | null
  login: (homeserver?: string) => Promise<void>
  logout: () => void
}

const ClientContext = createContext<ClientContextValue | null>(null)

// Hook every component uses to reach the live client + lifecycle state.
export function useClient(): ClientContextValue {
  const ctx = useContext(ClientContext)
  if (!ctx) throw new Error('useClient must be used within <ClientProvider>')
  return ctx
}

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

  // Bootstrap on mount: finish an in-progress login, resume a stored session,
  // or fall through to awaiting_login.
  useEffect(() => {
    if (bootstrapStarted) return
    bootstrapStarted = true

    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')

    if (code && state) {
      void completeLogin(code, state)
    } else if (loadSession()) {
      void resumeSession()
    } else {
      setStatus('awaiting_login')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  const completeLogin = async (code: string, state: string) => {
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
    } catch (err: any) {
      console.error('Login failed:', err)
      setError(err.message ?? String(err))
      setStatus('error')
    }
  }

  // Path 2: rebuild the client from the stored session — no MAS visit.
  const resumeSession = async () => {
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
    } catch (err: any) {
      console.error('Resume failed:', err)
      // Refresh also failed (refresh token dead) -> session is truly gone.
      clearSession()
      setUserId(null)
      setStatus('awaiting_login')
    }
  }

  // Begin a fresh login: discover homeserver, build the MAS auth URL, redirect.
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
    } catch (err: any) {
      console.error('Login start failed:', err)
      setError(err.message ?? String(err))
      setStatus('error')
    }
  }

  // Stop syncing, drop the session, return to the login screen.
  const logout = () => {
    client?.stopClient()
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
