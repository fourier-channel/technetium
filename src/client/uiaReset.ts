// ---------------------------------------------------------------------------
// Reading the approval URL out of Synapse's 401, for a cross-signing reset.
//
// Under MSC3861 the homeserver does not own passwords, so it cannot run a
// classic user-interactive auth flow for the one request that replaces an
// identity. Instead it answers 401 with an OAuth stage pointing at MAS:
//
//   {"session":"dummy",
//    "flows":[{"stages":["m.oauth"]},{"stages":["org.matrix.cross_signing_reset"]}],
//    "params":{"m.oauth":{"url":"https://auth.41chan.net/account/?action=org.matrix.cross_signing_reset"}}}
//
// Captured verbatim from the deployed server on 2026-09-10 while running E11
// against a throwaway. Until this was read, the reset failed with "[401]
// Unknown message" -- matrix-js-sdk could not name the error, because there is
// no errcode in that body at all.
//
// The user opens the URL, approves the reset in MAS, and the client retries.
// That second human step is not an obstacle to route around: it is the server
// insisting that replacing an identity is deliberate, which is the same thing
// D-e1 insists on from the other side.
//
// Pure, so the parsing is checked against the real body (O-tp9).
// ---------------------------------------------------------------------------

// The keys MAS/Synapse use for the stage. Both are accepted because the flows
// list offers both and the params object has been seen to carry either.
const OAUTH_STAGE = 'm.oauth'
const RESET_STAGE = 'org.matrix.cross_signing_reset'

export function crossSigningResetUrl(errorData: unknown): string | null {
  if (!errorData || typeof errorData !== 'object') return null
  const params = (errorData as { params?: unknown }).params
  if (!params || typeof params !== 'object') return null
  for (const stage of [OAUTH_STAGE, RESET_STAGE]) {
    const entry = (params as Record<string, unknown>)[stage]
    if (entry && typeof entry === 'object') {
      const url = (entry as { url?: unknown }).url
      // Only https, and only a real URL. This string is about to be opened in
      // the user's browser off the back of a server response, so a javascript:
      // or data: URL here would be a redirect straight into script execution.
      if (typeof url === 'string' && /^https:\/\//.test(url)) return url
    }
  }
  return null
}

// Does this failure mean "the user must approve it", rather than "it broke"?
// Distinguished because the two need opposite words: one is a next step, the
// other is an apology.
export function needsApproval(err: unknown): boolean {
  const e = err as { httpStatus?: unknown; data?: unknown } | null
  if (e?.httpStatus !== 401) return false
  return crossSigningResetUrl(e.data) !== null
}
