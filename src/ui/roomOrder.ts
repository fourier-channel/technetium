import type { TreeNode } from '../client/spaces'

// ---------------------------------------------------------------------------
// W3.4 -- custom sibling order for the nav tree (O-tp5).
//
// Order is per PARENT, not global: a room is dragged within its space, and a
// flat list would let it be dropped into another space's slot, which means
// nothing. '' is the root/orphan scope.
//
// Ids not present in a saved order fall back to their server position, and
// they sort FIRST -- a newly-joined room appearing at the top is noticeable,
// whereas appended to the bottom of a long space it is invisible. Same
// reasoning as thread order's newIds.
// ---------------------------------------------------------------------------

export function roomOrderScope(parentRoomId: string | null): string {
  return parentRoomId ?? ''
}

export function arrangeSiblings(nodes: TreeNode[], order: string[] | undefined): TreeNode[] {
  if (!order || order.length === 0) return nodes

  const byId = new Map(nodes.map((n) => [n.roomId, n]))
  const placed = new Set<string>()
  const known: TreeNode[] = []
  for (const id of order) {
    const n = byId.get(id)
    if (n) {
      known.push(n)
      placed.add(id)
    }
  }
  // Anything the saved order does not know about keeps its server order and
  // goes to the top.
  const fresh = nodes.filter((n) => !placed.has(n.roomId))
  return [...fresh, ...known]
}
