import type { ThreadScope } from '../client/useThreadList'
import { reportIgnored } from '../client/report'
// ---------------------------------------------------------------------------
// Custom thread-order persistence (v1: localStorage). Per D5 the v2 portable
// form is a net.41chan.thread_order account-data event; the localStorage key is
// namespaced the same way so the later lift is a move, not a rename. Order is a
// list of flip ids -- always (roomId, rootId) composite pairs, never bare
// rootIds (D5 key discipline).
//
// Per-scope (O2): "this room" and "all rooms" keep independent orders.
// ---------------------------------------------------------------------------

const PREFIX = 'net.41chan.thread_order'

export function orderScopeKey(scope: ThreadScope, roomId?: string): string {
  return scope === 'room' && roomId ? `room:${roomId}` : 'all'
}

export function loadCustomOrder(scopeKey: string): string[] | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}:${scopeKey}`)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
      return parsed as string[]
    }
    return null
  } catch (err) {
    reportIgnored('thread order: read', err)
    return null
  }
}

export function saveCustomOrder(scopeKey: string, ids: string[]): void {
  try {
    localStorage.setItem(`${PREFIX}:${scopeKey}`, JSON.stringify(ids))
  } catch (err) {
    reportIgnored('thread order: save', err)
  }
}
