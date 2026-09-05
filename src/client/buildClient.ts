import * as sdk from 'matrix-js-sdk'
import type { MatrixClient, TokenRefreshFunction } from 'matrix-js-sdk'
import { Thread, FeatureSupport } from 'matrix-js-sdk'
import { buildSlidingSync, slidingSyncEnabled } from './slidingSync'

export interface BuildClientParams {
  homeserverUrl: string
  accessToken: string
  userId: string
  deviceId?: string
  refreshToken?: string
  // When provided, the SDK calls this on token expiry to silently refresh.
  tokenRefreshFunction?: TokenRefreshFunction
}

// The sync cache is keyed BY USER, not by browser. One shared db meant
// store.startup() handed a fresh login the previous account's entire synced
// world -- rooms, DMs, and a sync token belonging to someone else -- which is
// exactly what the operator hit logging in as a test user on 2026-09-05: the
// admin's room list rendered, and the test user's own new DM was unopenable.
const SYNC_DB_BASENAME = 'matrix-client-sync'

const syncDbNameFor = (userId: string) => `${SYNC_DB_BASENAME}::${userId}`

// Best-effort delete of one user's sync cache (used on explicit logout, so a
// shared machine does not keep the departed user's room list readable). The
// SDK prefixes db names with "matrix-js-sdk:"; failures are swallowed because
// a cache that outlives its welcome is a nuisance, not a reason to break
// logout.
export function deleteSyncStore(userId: string): void {
  try {
    window.indexedDB.deleteDatabase(`matrix-js-sdk:${syncDbNameFor(userId)}`)
  } catch {
    // Nothing to do: the db either never existed or the browser refused.
  }
}

// Centralized client construction. Both fresh-login and resume go through here,
// so the persistent-store wiring lives in exactly one place.
//
// Uses IndexedDBStore so sync state survives reloads: the store keeps data
// in-memory but periodically flushes to IndexedDB, and startup() reloads it on
// next launch — so a refresh resumes from the saved sync token instead of doing
// a full initial sync. (This is also where crypto key storage will hang later.)
export async function buildClient(params: BuildClientParams): Promise<MatrixClient> {
  // The pre-fix shared db may still hold another account's world on machines
  // that logged in before the per-user keying landed. Nothing reads it any
  // more; deleting it is fire-and-forget (deleteDatabase blocks while an old
  // tab holds it open, which is why this is not awaited).
  try {
    window.indexedDB.deleteDatabase(`matrix-js-sdk:${SYNC_DB_BASENAME}`)
  } catch {
    // Best effort only.
  }

  const store = new sdk.IndexedDBStore({
    indexedDB: window.indexedDB,
    localStorage: window.localStorage,
    dbName: syncDbNameFor(params.userId),
  })

  const client = sdk.createClient({
    baseUrl: params.homeserverUrl,
    accessToken: params.accessToken,
    userId: params.userId,
    deviceId: params.deviceId,
    refreshToken: params.refreshToken,
    tokenRefreshFunction: params.tokenRefreshFunction,
    store,
  })

  // Must be called after createClient and before startClient: loads any
  // previously-persisted sync state from IndexedDB into the store.
  // Synapse supports stable threads server-side; opt into the efficient
  // server-side thread list/pagination endpoints.
  Thread.setServerSideSupport(FeatureSupport.Stable)
  Thread.setServerSideListSupport(FeatureSupport.Stable)
  Thread.setServerSideFwdPaginationSupport(FeatureSupport.Stable)

  await store.startup()

  return client
}

// Drive a client to its first PREPARED sync and resolve. Caller decides what to
// do with the rooms afterward. Rejects on sync ERROR.
export function startAndWaitForSync(client: MatrixClient): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    client.once(sdk.ClientEvent.Sync, (s: string) => {
      if (s === 'PREPARED') resolve()
      else if (s === 'ERROR') reject(new Error('Sync failed'))
    })
    // EXPERIMENTAL: native Simplified Sliding Sync (MSC4186), opt-in via
    // VITE_SLIDING_SYNC. Windowed room loading -> a far lighter initial sync.
    // All the fragile internal-SDK wiring is isolated in ./slidingSync. Default
    // (flag off) is the classic sync below, untouched.
    if (slidingSyncEnabled()) {
      // lazyLoadMembers: sliding sync's required_state carries only $ME, so the
      // SDK must treat each room's roster as PARTIAL and lazy-fetch the rest on
      // demand (room.loadMembersIfNeeded on open) -- otherwise the member list
      // shows only self. See src/ui/MemberList.tsx.
      client.startClient({ slidingSync: buildSlidingSync(client), threadSupport: true, lazyLoadMembers: true })
      return
    }
    // threadSupport is a startClient option (read from clientOpts), NOT a
    // createClient option — pass it here so the SDK routes m.thread
    // replies into Thread timelines instead of the main timeline.
    client.startClient({ initialSyncLimit: 1, threadSupport: true })
  })
}
