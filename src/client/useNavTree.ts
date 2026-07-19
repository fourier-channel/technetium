import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ClientEvent,
  RoomEvent,
  RoomStateEvent,
  type MatrixClient,
  type MatrixEvent,
} from 'matrix-js-sdk'
import { buildNavTree, collectParentedIds, type HierarchyRoom, type NavTree } from './spaces'
import { isEmptyTree, loadServerShape, saveServerShape } from './serverShape'

export interface NavTreeState {
  tree: NavTree | null
  loading: boolean
  // true while the tree shown is the cached "last known shape" and the live
  // sync hasn't produced a real (non-empty) tree yet (CD-11).
  stale: boolean
}

// Top-level spaces the user is joined to: joined space rooms not referenced as
// a child of any other joined space. Read from sync (not the hierarchy) to
// avoid a chicken-and-egg on what to query.
function discoverRootSpaces(client: MatrixClient): string[] {
  const joinedSpaces = client
    .getRooms()
    .filter((r) => r.isSpaceRoom() && r.getMyMembership() === 'join')
  const childIds = new Set<string>()
  for (const s of joinedSpaces)
    for (const e of s.currentState.getStateEvents('m.space.child'))
      if (Object.keys(e.getContent()).length > 0) {
        const k = e.getStateKey()
        if (k) childIds.add(k)
      }
  return joinedSpaces.map((s) => s.roomId).filter((id) => !childIds.has(id))
}

// Fetch one space's full hierarchy, following next_batch to completion.
async function fetchSpaceHierarchy(
  client: MatrixClient,
  spaceId: string,
  isCancelled: () => boolean,
): Promise<HierarchyRoom[]> {
  const out: HierarchyRoom[] = []
  let from: string | undefined = undefined
  let guard = 0
  do {
    const res = await client.getRoomHierarchy(spaceId, 50, undefined, false, from)
    out.push(...(res.rooms as HierarchyRoom[]))
    from = res.next_batch
    guard += 1
  } while (from && !isCancelled() && guard < 20)
  return out
}

// How much real STRUCTURE a tree carries (top-level spaces + every room placed
// under a space). A mid-load rebuild with no hierarchy fetched scores near zero;
// the cached full tree scores high. Used to reject structurally-degraded builds.
function structureScore(t: NavTree | null): number {
  return t ? t.spaces.length + collectParentedIds(t).size : 0
}

// Hybrid nav tree: structure + names from getRoomHierarchy (includes unjoined
// rooms), live membership overlaid from sync. Returns a loading flag; never
// blanks the tree mid-fetch (keep-previous).
export function useNavTree(client: MatrixClient | null): NavTreeState {
  // Seed from the cached "last known shape" so the room list paints instantly.
  const [tree, setTree] = useState<NavTree | null>(() => loadServerShape())
  const [loading, setLoading] = useState<boolean>(!!client)
  const [stale, setStale] = useState<boolean>(() => !isEmptyTree(loadServerShape()))
  const cacheRef = useRef<HierarchyRoom[]>([])
  const fetchSeq = useRef(0)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Grow-only set of rooms known to live under a space (seeded from the cached
  // shape). Passed to every build so a transient rebuild can't demote a child to
  // a loose orphan before its parent hierarchy is re-fetched (the "children in
  // Direct-and-Other" flash). Never shrinks within a session.
  const parentedRef = useRef<Set<string>>(collectParentedIds(loadServerShape()))
  // Mirror of the current tree so commit can compare synchronously.
  const treeRef = useRef<NavTree | null>(tree)
  useEffect(() => {
    treeRef.current = tree
  }, [tree])

  // Commit a freshly-built tree, unless it would REGRESS the structure. A build
  // is `authoritative` only when it came from a real fetched hierarchy (roots
  // discovered) -- that reflects current server state and may legitimately be
  // smaller. A non-authoritative build (cheap overlay, or a rebuild before the
  // hierarchy is fetched) must never replace a structurally richer tree: that
  // was the "first live room collapses the whole cached tree" flash.
  const commit = useCallback((built: NavTree, authoritative: boolean) => {
    if (isEmptyTree(built)) return
    const prev = treeRef.current
    if (!authoritative && prev && structureScore(built) < structureScore(prev)) return
    treeRef.current = built
    setTree(built)
    for (const id of collectParentedIds(built)) parentedRef.current.add(id) // grow-only
    saveServerShape(built)
    setStale(false)
  }, [])

  // Cheap: re-overlay membership/names on the cached skeleton (no network). Skip
  // when there's no hierarchy skeleton yet -- rebuilding from nothing degrades.
  const rebuildFromCache = useCallback(() => {
    if (!client || cacheRef.current.length === 0) return
    commit(buildNavTree(client, cacheRef.current, parentedRef.current), false)
  }, [client, commit])

  // Expensive: re-discover roots and re-fetch every hierarchy, then rebuild.
  const refetch = useCallback(async () => {
    if (!client) return
    const seq = ++fetchSeq.current
    setLoading(true)
    try {
      const roots = discoverRootSpaces(client)
      const all: HierarchyRoom[] = []
      for (const rootId of roots) {
        const rooms = await fetchSpaceHierarchy(
          client,
          rootId,
          () => seq !== fetchSeq.current,
        )
        if (seq !== fetchSeq.current) return // superseded
        all.push(...rooms)
      }
      if (seq !== fetchSeq.current) return
      // Only overwrite the skeleton with a real fetch (don't wipe it to empty
      // when no roots are loaded yet). Authoritative iff we actually found roots.
      if (all.length > 0) cacheRef.current = all
      commit(buildNavTree(client, all, parentedRef.current), roots.length > 0)
    } catch (err) {
      console.error('useNavTree: hierarchy fetch failed', err)
      // leave the previous tree in place
    } finally {
      if (seq === fetchSeq.current) setLoading(false)
    }
  }, [client, commit])

  useEffect(() => {
    if (!client) {
      setTree(null)
      setLoading(false)
      cacheRef.current = []
      return
    }

    void refetch() // initial load

    const scheduleRefetch = () => {
      if (debounce.current) clearTimeout(debounce.current)
      debounce.current = setTimeout(() => {
        debounce.current = null
        void refetch()
      }, 300)
    }

    // Membership change: instant overlay from cache (snappy join feedback) plus
    // a debounced refetch in case a newly-joined space revealed children.
    const onMembership = () => {
      rebuildFromCache()
      scheduleRefetch()
    }
    // Only m.space.child state changes alter structure -> refetch. Other state
    // events must NOT trigger a network refetch.
    const onState = (event: MatrixEvent) => {
      if (event.getType() === 'm.space.child') scheduleRefetch()
    }

    client.on(RoomEvent.MyMembership, onMembership)
    client.on(RoomEvent.Name, rebuildFromCache)
    client.on(ClientEvent.Room, scheduleRefetch)
    client.on(ClientEvent.DeleteRoom, scheduleRefetch)
    client.on(RoomStateEvent.Events, onState)

    return () => {
      if (debounce.current) clearTimeout(debounce.current)
      fetchSeq.current++ // cancel any in-flight fetch
      client.off(RoomEvent.MyMembership, onMembership)
      client.off(RoomEvent.Name, rebuildFromCache)
      client.off(ClientEvent.Room, scheduleRefetch)
      client.off(ClientEvent.DeleteRoom, scheduleRefetch)
      client.off(RoomStateEvent.Events, onState)
    }
  }, [client, refetch, rebuildFromCache])

  return { tree, loading, stale }
}
