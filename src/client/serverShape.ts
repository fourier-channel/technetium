import type { NavTree, TreeNode } from './spaces'

// ---------------------------------------------------------------------------
// "Last known server shape" (CD-11 stale-then-live). We persist the nav tree's
// STRUCTURE -- room ids, names, space/room, membership, join rule, nesting --
// so the very next boot can paint the user's room list instantly (marked
// stale) instead of a blank "Syncing..." while the real sync catches up. The
// live tree replaces it the moment a non-empty real one arrives.
//
// The live `room: Room` handle is intentionally dropped: it isn't serializable
// and a stale node has no live room yet (it's a picture of last time, not a
// live connection). Reconstructed stale nodes carry room: null; the nav treats
// them as un-clickable-until-live, which is exactly right during boot.
// ---------------------------------------------------------------------------

const KEY = 'net.41chan.server_shape'

interface ShapeNode {
  roomId: string
  name: string
  isSpace: boolean
  membership: string | null
  joinRule: string | null
  children: ShapeNode[]
}

export function isEmptyTree(t: NavTree | null | undefined): boolean {
  return !t || (t.spaces.length === 0 && t.orphanRooms.length === 0)
}

function toShape(n: TreeNode): ShapeNode {
  return {
    roomId: n.roomId,
    name: n.name,
    isSpace: n.isSpace,
    membership: n.membership,
    joinRule: n.joinRule,
    children: n.children.map(toShape),
  }
}

// Reconstruct a TreeNode from cache. Defensive (go-fish, CD-10): anything that
// isn't a well-formed node is dropped, never thrown over.
function fromShape(s: unknown): TreeNode | null {
  if (!s || typeof s !== 'object') return null
  const o = s as Record<string, unknown>
  if (typeof o.roomId !== 'string') return null
  const kids = Array.isArray(o.children)
    ? (o.children.map(fromShape).filter(Boolean) as TreeNode[])
    : []
  return {
    roomId: o.roomId,
    name: typeof o.name === 'string' ? o.name : o.roomId,
    isSpace: o.isSpace === true,
    membership: typeof o.membership === 'string' ? o.membership : null,
    joinRule: typeof o.joinRule === 'string' ? o.joinRule : null,
    room: null,
    children: kids,
  }
}

export function saveServerShape(tree: NavTree): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        spaces: tree.spaces.map(toShape),
        orphanRooms: tree.orphanRooms.map(toShape),
      }),
    )
  } catch {
    // best-effort; a full/blocked store just means no stale preview next time
  }
}

export function loadServerShape(): NavTree | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as { spaces?: unknown[]; orphanRooms?: unknown[] }
    const spaces = Array.isArray(p.spaces) ? (p.spaces.map(fromShape).filter(Boolean) as TreeNode[]) : []
    const orphanRooms = Array.isArray(p.orphanRooms)
      ? (p.orphanRooms.map(fromShape).filter(Boolean) as TreeNode[])
      : []
    if (spaces.length === 0 && orphanRooms.length === 0) return null
    return { spaces, orphanRooms }
  } catch {
    return null
  }
}
