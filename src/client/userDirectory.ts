import type { MatrixClient } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// W3.6 -- resolving "who do you mean?" for the user picker.
//
// Three sources, in order of confidence:
//   1. members already known locally -- instant, no request
//   2. the server's user directory -- covers people not in any shared room
//   3. a raw MXID typed by hand -- the escape hatch when the directory does
//      not surface someone (it only indexes users who share a room or are
//      published, so a valid id can be missing from it entirely)
// ---------------------------------------------------------------------------

// @localpart:server.tld -- deliberately permissive about the localpart, which
// the spec allows to contain a wide range, and strict about the shape.
const MXID_RE = /^@[^\s:]+:[^\s:/]+(:\d+)?$/

export function isValidMxid(input: string): boolean {
  return MXID_RE.test(input.trim())
}

export interface DirectoryUser {
  userId: string
  displayName?: string
  avatarMxc?: string
}

// Where a candidate came from, in descending order of confidence:
//
//   'local'     -- already in a room with you. They exist, and you can reach
//                  them. No ambiguity at all.
//   'directory' -- the server's directory found them. They exist.
//   'raw'       -- you typed a well-formed id. NOBODY HAS CONFIRMED IT EXISTS.
//                  The shape is valid; the person may not be.
//
// The picker used to flatten all three into one list, which made the third
// indistinguishable from the first two -- so a typo that happened to be
// well-formed looked exactly like a real person.
export type CandidateSource = 'local' | 'directory' | 'raw'

export interface Candidate extends DirectoryUser {
  source: CandidateSource
}

// Search the server's user directory. Returns [] rather than throwing when the
// server declines -- some homeservers disable it, and a picker that explodes
// is worse than one that only offers local members.
export async function searchDirectory(
  client: MatrixClient,
  term: string,
  limit = 10,
): Promise<DirectoryUser[]> {
  if (!term.trim()) return []
  try {
    const res = await client.searchUserDirectory({ term, limit })
    return (res.results ?? []).map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      avatarMxc: r.avatar_url,
    }))
  } catch {
    // Intentional and silent: a server with the directory disabled answers
    // an error on EVERY keystroke. The picker degrades to local members,
    // which is the documented behaviour, not a failure to report.
    return []
  }
}

// Merge local members, directory hits and a hand-typed id into one ordered,
// de-duplicated list. Local members first: they are who the user most often
// means, and they are the only entries with a known display name in context.
export function mergeCandidates(
  local: DirectoryUser[],
  directory: DirectoryUser[],
  rawInput: string,
  excludeUserIds: Set<string>,
): Candidate[] {
  const seen = new Set<string>(excludeUserIds)
  const out: Candidate[] = []

  const push = (u: DirectoryUser, source: CandidateSource) => {
    if (!u.userId || seen.has(u.userId)) return
    seen.add(u.userId)
    out.push({ ...u, source })
  }

  // Order is also precedence: the first source to claim an id keeps it, so
  // someone already in your rooms is never relabelled as an unverified guess.
  for (const u of local) push(u, 'local')
  for (const u of directory) push(u, 'directory')

  // A hand-typed id goes LAST: it is the fallback, and surfacing it above real
  // matches would let a typo outrank the person being looked for.
  const raw = rawInput.trim()
  if (isValidMxid(raw)) push({ userId: raw }, 'raw')

  return out
}

// Surface the API's own reason. A 403 on invite means insufficient power
// level, and saying "invite failed" when the server said exactly why is the
// kind of vagueness that makes people retry pointlessly.
export function describeInviteError(err: unknown): string {
  const e = err as { errcode?: string; httpStatus?: number; message?: string }
  if (e?.httpStatus === 403 || e?.errcode === 'M_FORBIDDEN') {
    return 'You do not have permission to invite people to this room.'
  }
  if (e?.errcode === 'M_LIMIT_EXCEEDED') return 'Rate-limited by the server. Try again shortly.'
  if (e?.errcode === 'M_UNKNOWN' || e?.errcode === 'M_NOT_FOUND') {
    return 'That user could not be found on their server.'
  }
  return e?.message ?? 'The invite failed.'
}
