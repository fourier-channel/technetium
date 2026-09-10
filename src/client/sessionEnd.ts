// What ending a session actually does, as data rather than as three hand-rolled
// teardowns that drifted apart.
//
// There were two before this, and they disagreed in a way that cost real
// traffic. `logout` stopped the client and dropped the sync cache. The resume
// failure path cleared the stored session but LEFT THE CLIENT RUNNING, so a tab
// resuming a revoked session kept syncing forever against a dead token --
// measured 2026-09-07 at roughly 2800 requests an hour from a single tab, every
// one a 401. Stopping the client is not a policy choice; a session that has
// ended has no business holding a sync loop open.
//
// What IS a policy choice is the sync cache, and the operator settled it
// 2026-09-07: "If explicit logout drops the sync cache then revoking should do
// the same. A 'destructive' action that is part of the normal logout flow is
// appropriate for a ban." So `revoked` is defined here as identical to
// `logout`, and the check asserts that equality rather than trusting two
// literals to stay in step.
//
// A failed resume stays the exception, for the reason the original comment
// gave: the user whose token merely expired is likely to come straight back,
// and their cache is worth keeping.

export type SessionEndReason =
  // The user chose to sign out.
  | 'logout'
  // The server rejected our token and no refresh can save it: signed out from
  // another device, session killed server-side, or banned.
  | 'revoked'
  // A stored session could not be brought up (dead refresh token, network).
  | 'resume_failed'
  // The stored session named one device but its tokens were another's: a tab
  // on an older login had written over the record (sessionIdentity.ts). The
  // user is the same, so the cache is as good as on any failed resume; the
  // record is cleared so the other tab stops writing into it.
  | 'foreign_tokens'

export interface SessionEndPlan {
  // Halt the sync loop. Always true: see the header.
  stopClient: boolean
  // Drop this user's room/timeline cache from IndexedDB.
  deleteSyncStore: boolean
  // Forget the stored access + refresh tokens.
  clearStoredSession: boolean
  // NEVER true, for any reason. Losing device keys is the harm E8 exists to
  // prevent, and no sign-out is worth it. Present as a field so the check can
  // assert it across every reason rather than trusting prose.
  deleteCryptoStore: boolean
}

export function planSessionEnd(reason: SessionEndReason): SessionEndPlan {
  return {
    stopClient: true,
    // The operator's ruling: a revoked session is a logout, not a hiccup.
    deleteSyncStore: reason === 'logout' || reason === 'revoked',
    clearStoredSession: true,
    deleteCryptoStore: false,
  }
}

// Every reason, so a check can walk them without importing a duplicate list
// that would rot the moment a fourth is added.
export const SESSION_END_REASONS: readonly SessionEndReason[] = [
  'logout',
  'revoked',
  'resume_failed',
  'foreign_tokens',
]
