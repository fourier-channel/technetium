import type { MatrixClient } from 'matrix-js-sdk'
import { reportIgnored } from './report'
// ---------------------------------------------------------------------------
// W4.4 -- block / ignore.
//
// `m.ignored_user_list` is ACCOUNT DATA, so ignoring is account-wide and
// follows the user to every client and device. The server also stops sending
// most of an ignored user's events, but not retroactively: events already in
// a loaded timeline stay there, which is why the renderer filters as well.
//
// Ignoring is a whole-list replace, like pinned events, so it is
// read-modify-write and the freshest list is read immediately before writing.
// ---------------------------------------------------------------------------

export function getIgnoredUsers(client: MatrixClient): string[] {
  try {
    return client.getIgnoredUsers() ?? []
  } catch (err) {
    // Returning [] means ignored users become VISIBLE again. That is a
    // behaviour change, not a no-op, so it must not be silent.
    reportIgnored('ignore list: read', err)
    return []
  }
}

export function isIgnored(client: MatrixClient | null, userId: string): boolean {
  if (!client) return false
  return getIgnoredUsers(client).includes(userId)
}

export async function setIgnored(
  client: MatrixClient,
  userId: string,
  ignored: boolean,
): Promise<void> {
  const current = getIgnoredUsers(client)
  const has = current.includes(userId)
  if (ignored === has) return
  const next = ignored ? [...current, userId] : current.filter((id) => id !== userId)
  await client.setIgnoredUsers(next)
}

// Never let someone ignore themselves. The server would accept it and the
// result is a client that hides its own messages, which reads as data loss.
export function canIgnore(client: MatrixClient | null, userId: string): boolean {
  if (!client) return false
  return client.getUserId() !== userId
}
