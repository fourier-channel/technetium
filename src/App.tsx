import { useEffect, useState } from 'react'
import * as sdk from 'matrix-js-sdk'
import { saveSession, loadSession, clearSession } from './client/session'
import { buildClient, startAndWaitForSync } from './client/buildClient'
import { createTokenRefreshFunction } from './client/tokenRefresher'

// MAS redirects back here after login. Must match the URL in your browser's
// address bar (the browser is what gets redirected), and must match the
// redirect_uri registered for this client in MAS.
const REDIRECT_URI = window.location.origin + '/'

// Statically-registered public client id (see mas/config.yaml on the remote
// server). We use a static client instead of dynamic registration because MAS's
// registration policy rejects http/loopback URIs for dynamically-registered clients.
const CLIENT_ID = '00000000000000000000DEVWEB'

// Guard against React StrictMode's double-invoke of effects in development. Both
// the OIDC code exchange (single-use code) and the resume path (avoid building
// two clients) must run at most once; this module-level flag survives a
// StrictMode remount, where component state would not.
let bootstrapStarted = false

function App() {
  const [homeserver, setHomeserver] = useState('https://41chan.net')
  const [status, setStatus] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [rooms, setRooms] = useState<string[]>([])

  // On load: decide between three paths —
  //   1. returning from MAS (?code & ?state present) -> finish login
  //   2. a stored session exists -> resume without visiting MAS
  //   3. neither -> show the login form
  useEffect(() => {
    if (bootstrapStarted) return // StrictMode re-invoke
    bootstrapStarted = true

    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')

    if (code && state) {
      void completeLogin(code, state)
    } else if (loadSession()) {
      void resumeSession()
    }
    // else: no code, no session -> fall through to the login form
  }, [])

  // Path 1: exchange the MAS authorization code, persist the session, sync.
  const completeLogin = async (code: string, state: string) => {
    try {
      setStatus('Completing login...')
      const result = await sdk.completeAuthorizationCodeGrant(code, state)
      const accessToken = result.tokenResponse.access_token
      const homeserverUrl = result.homeserverUrl
      console.log('Token exchange result:', result)

      // Clean the ?code&state out of the URL so a refresh doesn't re-run this.
      window.history.replaceState({}, '', REDIRECT_URI)

      // Resolve our own user id (a token-only client doesn't know who it is).
      setStatus('Fetching identity...')
      const whoamiClient = sdk.createClient({ baseUrl: homeserverUrl, accessToken })
      const whoami = await whoamiClient.whoami()
      const myUserId = whoami.user_id
      const myDeviceId = whoami.device_id ?? ''
      console.log('whoami:', whoami)

      // Persist the session so a refresh can resume without re-visiting MAS.
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
      console.log('Session saved')

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
      setUserId(myUserId)
      setStatus(`Logged in as ${myUserId}`)
    } catch (err: any) {
      console.error('Login failed:', err)
      setStatus(`Login failed: ${err.message ?? String(err)}`)
    }
  }

  // Path 2: rebuild the client from the stored session and sync — no MAS visit.
  const resumeSession = async () => {
    const s = loadSession()
    if (!s) return
    try {
      setStatus('Resuming session...')
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
      setUserId(s.userId)
      setStatus(`Logged in as ${s.userId}`)
    } catch (err: any) {
      console.error('Resume failed:', err)
      // If refresh also failed (refresh token expired/revoked), the session is
      // truly dead — drop it and show the login form.
      clearSession()
      setStatus('Session expired — please log in again.')
    }
  }

  // Shared: build the persistent-store client, sync, and populate the room list.
  const startSyncedClient = async (params: {
    homeserverUrl: string
    accessToken: string
    userId: string
    deviceId?: string
    refreshToken?: string
    tokenRefreshFunction?: sdk.TokenRefreshFunction
  }) => {
    setStatus('Syncing rooms...')
    const client = await buildClient(params)
    await startAndWaitForSync(client)
    const names = client.getRooms().map((r) => r.name || r.roomId)
    setRooms(names)
  }

  const handleLogin = async () => {
    try {
      // 1. Resolve the real homeserver URL via .well-known delegation.
      setStatus('Discovering homeserver...')
      const discovery = await sdk.AutoDiscovery.findClientConfig(homeserver)
      const hsResult = discovery['m.homeserver']
      if (hsResult.state !== 'SUCCESS') {
        throw new Error(`Discovery failed: ${hsResult.state} ${hsResult.error ?? ''}`)
      }
      const baseUrl = hsResult.base_url
      if (!baseUrl) throw new Error('Discovery returned no base URL')

      // 2. Ask the homeserver where auth is delegated (MAS) and validate it.
      setStatus('Fetching auth metadata...')
      const tmpClient = sdk.createClient({ baseUrl })
      const authMetadata = await tmpClient.getAuthMetadata()
      console.log('Auth metadata:', authMetadata)

      // 3. Use the statically-registered public client id (no dynamic registration).
      const clientId = CLIENT_ID

      // 4. Build the authorization URL (the SDK stashes PKCE state in
      //    sessionStorage for the return leg) and redirect to MAS.
      setStatus('Redirecting to MAS...')
      const nonce = crypto.randomUUID().replace(/-/g, '')
      const authUrl = await sdk.generateOidcAuthorizationUrl({
        metadata: authMetadata,
        redirectUri: REDIRECT_URI,
        clientId,
        homeserverUrl: baseUrl,
        nonce,
      })
      window.location.href = authUrl
    } catch (err: any) {
      console.error('Login failed:', err)
      setStatus(`Login failed: ${err.message ?? String(err)}`)
    }
  }

  // Logged-in view: show identity and the room list.
  if (userId) {
    return (
      <div style={{ maxWidth: 480, margin: '4rem auto', fontFamily: 'sans-serif' }}>
        <h1>matrix-client</h1>
        <p>Logged in as <strong>{userId}</strong></p>
        <h2>Rooms ({rooms.length})</h2>
        <ul>
          {rooms.map((name, i) => (
            <li key={i}>{name}</li>
          ))}
        </ul>
        {status && <p style={{ color: '#888' }}>{status}</p>}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 360, margin: '4rem auto', fontFamily: 'sans-serif' }}>
      <h1>matrix-client</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <label>
          Homeserver
          <input
            type="text"
            value={homeserver}
            onChange={(e) => setHomeserver(e.target.value)}
            style={{ width: '100%' }}
          />
        </label>
        <button type="button" onClick={handleLogin}>
          Log in with Matrix
        </button>
        {status && <p>{status}</p>}
      </div>
    </div>
  )
}

export default App
