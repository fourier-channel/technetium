import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { ThreadEvent, ClientEvent, RoomEvent, type MatrixClient, type Room, type Thread } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// Thread list model. Normalized, flat items so filtering/sorting/favorites
// operate on plain fields -- never on MatrixEvents. Stats (post/media counts,
// per-user breakdown) are computed once per rebuild, not per render.
// ---------------------------------------------------------------------------

export interface ThreadUserStats {
  userId: string
  posts: number
  media: number
}

export interface ThreadListItem {
  roomId: string
  roomName: string
  rootId: string
  thread: Thread
  author: string
  createdTs: number
  lastTs: number
  replyCount: number
  postCount: number
  mediaCount: number
  posterCount: number
  perUser: ThreadUserStats[]
  participated: boolean
  // Favorites land in step 3 (room account data); present now so the model
  // is stable for the UI.
  favorite: boolean
}

export type ThreadScope = 'room' | 'all'
export type ThreadSort = 'latest-activity' | 'created' | 'reply-count'

export interface ThreadListOptions {
  // Room to scope to when scope === 'room'.
  roomId?: string
  scope?: ThreadScope
  sort?: ThreadSort
  participatedOnly?: boolean
  favoritesOnly?: boolean
}

// User-changeable defaults, eventually read from global account data
// (net.41chan.thread_list_prefs). Stubbed here so the future feature is a
// field-read away, not a refactor.
export function threadListDefaults(): { scope: ThreadScope; sort: ThreadSort } {
  return { scope: 'room', sort: 'latest-activity' }
}

const MEDIA_TYPES = new Set(['m.image', 'm.file', 'm.video', 'm.audio'])

// Walk a thread's events (root + replies) once, producing all stats.
function threadStats(thread: Thread): {
  postCount: number
  mediaCount: number
  perUser: ThreadUserStats[]
} {
  const tl = thread.timeline
  const rootEv = thread.rootEvent
  const events =
    rootEv && !tl.some((e) => e.getId() === rootEv.getId()) ? [rootEv, ...tl] : tl

  const byUser = new Map<string, { posts: number; media: number }>()
  let posts = 0
  let media = 0
  for (const ev of events) {
    if (ev.getType() !== 'm.room.message') continue
    const sender = ev.getSender()
    if (!sender) continue
    const msgtype = ev.getContent()?.msgtype
    const isMedia = typeof msgtype === 'string' && MEDIA_TYPES.has(msgtype)
    posts++
    if (isMedia) media++
    const u = byUser.get(sender) ?? { posts: 0, media: 0 }
    u.posts++
    if (isMedia) u.media++
    byUser.set(sender, u)
  }
  const perUser = [...byUser.entries()]
    .map(([userId, v]) => ({ userId, posts: v.posts, media: v.media }))
    .sort((a, b) => b.posts - a.posts)
  return { postCount: posts, mediaCount: media, perUser }
}

const SORTERS: Record<ThreadSort, (a: ThreadListItem, b: ThreadListItem) => number> = {
  'latest-activity': (a, b) => b.lastTs - a.lastTs,
  created: (a, b) => b.createdTs - a.createdTs,
  'reply-count': (a, b) => b.replyCount - a.replyCount,
}

// Live thread list. Aggregates room.getThreads() (in-memory, sync-fed, with a
// one-shot fetchRoomThreads() server backfill per joined room so age/scrollback
// horizons don't hide threads), normalizes to ThreadListItem, then applies
// scope/filters/sort. Stays live via client-level ThreadEvent re-emission.
export function useThreadList(
  client: MatrixClient | null,
  options: ThreadListOptions = {},
): ThreadListItem[] {
  const defaults = threadListDefaults()
  const scope = options.scope ?? defaults.scope
  const sort = options.sort ?? defaults.sort
  const { roomId, participatedOnly, favoritesOnly } = options

  const [all, setAll] = useState<ThreadListItem[]>([])

  const rebuild = useCallback(() => {
    if (!client) {
      setAll([])
      return
    }
    const me = client.getUserId()
    const out: ThreadListItem[] = []
    for (const room of client.getRooms()) {
      if (room.getMyMembership() !== 'join') continue
      for (const thread of room.getThreads()) {
        const rootEv = thread.rootEvent
        const rootId = rootEv?.getId()
        if (!rootId) continue
        const last = thread.replyToEvent ?? rootEv ?? null
        const stats = threadStats(thread)
        const participated =
          thread.hasCurrentUserParticipated ??
          (me ? stats.perUser.some((u) => u.userId === me) : false)
        out.push({
          roomId: room.roomId,
          roomName: room.name || room.roomId,
          rootId,
          thread,
          author: rootEv?.getSender() ?? '(unknown)',
          createdTs: rootEv?.getTs() ?? 0,
          lastTs: last?.getTs() ?? 0,
          replyCount: thread.length,
          postCount: stats.postCount,
          mediaCount: stats.mediaCount,
          posterCount: stats.perUser.length,
          perUser: stats.perUser,
          participated,
          favorite: false, // step 3: merged from room account data
        })
      }
    }
    setAll(out)
  }, [client])

  // Per-room server-side thread backfill: idempotent + retryable. fetchRoomThreads
  // deposits into room.threadsTimelineSets, which are EMPTY until
  // createThreadsTimelineSets() runs (the SDK null-chains the deposit, so an
  // uninitialized room makes the fetch a silent no-op). Marked done on success;
  // on failure the room is un-marked so a later sync tick retries it -- heavy
  // initial sync often starves the first attempt.
  const backfilledRef = useRef<Set<string>>(new Set())
  const backfillRoom = useCallback(
    (room: Room) => {
      if (room.getMyMembership() !== 'join') return
      if (backfilledRef.current.has(room.roomId)) return
      backfilledRef.current.add(room.roomId)
      void room
        .createThreadsTimelineSets()
        .then(() => room.fetchRoomThreads())
        .then(rebuild)
        .catch((e) => {
          backfilledRef.current.delete(room.roomId) // allow a later retry
          console.warn('[threads] backfill failed:', room.roomId, e)
        })
    },
    [rebuild],
  )

  useEffect(() => {
    if (!client) return
    // Backfill every joined room now, AND every room that syncs in later. The
    // old one-shot loop iterated getRooms() at mount only, so under a heavy
    // initial sync every room that landed afterwards was never hydrated -- its
    // threads stayed at whatever sync happened to deliver ("only the very first
    // threads"). Driving off ClientEvent.Room spreads the /threads requests as
    // rooms arrive (also gentler on the congestion) and covers late rooms.
    for (const room of client.getRooms()) backfillRoom(room)
    // Populate immediately from already-synced threads (deferred a microtask so
    // this isn't a synchronous setState in the effect body).
    queueMicrotask(rebuild)

    const onChange = () => rebuild()
    const onRoom = (room: Room) => {
      backfillRoom(room)
      rebuild()
    }
    // The client re-emits room-level ThreadEvents, but its typed EmittedEvents
    // union doesn't enumerate them -- cast the event names. Runtime is correct
    // (verified: live cross-room thread updates fire); this is types-only.
    type ClientEv = Parameters<typeof client.on>[0]
    const TE_NEW = ThreadEvent.New as unknown as ClientEv
    const TE_UPDATE = ThreadEvent.Update as unknown as ClientEv
    const TE_NEWREPLY = ThreadEvent.NewReply as unknown as ClientEv
    client.on(TE_NEW, onChange)
    client.on(TE_UPDATE, onChange)
    client.on(TE_NEWREPLY, onChange)
    client.on(ClientEvent.Room, onRoom)
    client.on(RoomEvent.MyMembership, onRoom)
    return () => {
      client.off(TE_NEW, onChange)
      client.off(TE_UPDATE, onChange)
      client.off(TE_NEWREPLY, onChange)
      client.off(ClientEvent.Room, onRoom)
      client.off(RoomEvent.MyMembership, onRoom)
    }
  }, [client, rebuild, backfillRoom])

  // Scope -> filters -> sort, all pure over the normalized items.
  return useMemo(() => {
    let items = all
    if (scope === 'room' && roomId) items = items.filter((i) => i.roomId === roomId)
    if (participatedOnly) items = items.filter((i) => i.participated)
    if (favoritesOnly) items = items.filter((i) => i.favorite)
    return [...items].sort(SORTERS[sort])
  }, [all, scope, roomId, participatedOnly, favoritesOnly, sort])
}
