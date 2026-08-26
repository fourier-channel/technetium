import { useEffect, useRef, useState, useCallback } from 'react'
import {
  ClientEvent,
  RoomEvent,
  type IContent,
  type MatrixClient,
  type Room,
  type MatrixEvent,
} from 'matrix-js-sdk'
import { MEDIA_TAGS_EVENT } from './mediaTags'
import { getIgnoredUsers } from './ignoredUsers'
import { isBackgroundPost } from './backgroundPost'
import { INTERACTION_EVENT } from './interactionEvents'
import { reportIgnored } from './report'
import { isSystemEvent } from './systemEvents'
import { useShowSystemEvents } from './systemEventPref'
import {
  buildRelationIndex,
  effectiveContent,
  isRelationOnlyEvent,
  resolveReply,
  type ReactionTally,
  type ReplyRef,
} from './relations'

// Classification the renderer switches on, so it never re-parses event shape.
export type TimelineItemKind =
  | 'message'
  | 'encrypted'
  | 'redacted'
  | 'other'
  | 'gallery'
  // A membership change (m.room.member). Its own kind because it renders as a
  // PERSON rather than as a message: no sender pill, no action bar, no footer.
  | 'member'
  // W6.1 -- a date marker inserted BETWEEN items. Carries no event of its own.
  | 'day'

export type GalleryLayout = 'grid' | 'stack' | 'strip'

export interface TimelineItem {
  event: MatrixEvent
  kind: TimelineItemKind
  id: string
  // kind 'gallery' only: cells sized to the batch's declared count, with images
  // placed by their net.41chan.gallery.index. null = a slot whose image hasn't
  // arrived (pending, failed, or interleaved elsewhere in the timeline).
  cells?: (MatrixEvent | null)[]
  // kind 'gallery' only: the sender's chosen layout (defaults to 'grid').
  layout?: GalleryLayout

  // --- S1 relations read layer ---
  // Effective content with the winning m.replace applied. Renderers must read
  // THIS, never event.getContent(), so an edit shows without depending on
  // whether the sdk happened to aggregate the replacement.
  content: IContent
  // Set when an edit was applied; carries the edit's timestamp for the marker.
  editedTs?: number
  // Aggregated m.annotation reactions, in first-seen key order. Absent when
  // the event has none, so the footer renders nothing.
  reactions?: ReactionTally[]
  // A user-authored reply target (thread fallbacks are excluded). `event` is
  // null when the target is outside the loaded window.
  replyTo?: ReplyRef

  // --- W6 layout ---
  // False when this message continues a run from the same sender, so the Row
  // hides the pillbox. Every other decoration (action bar, reactions,
  // receipts, edited marker, reply pill) is unaffected -- grouping collapses
  // the HEADER, never the footer.
  showHeader?: boolean
  // kind 'day' only: the timestamp the separator labels.
  dayTs?: number
}

// How long a gap breaks a same-sender run. Beyond this, two messages are
// separate thoughts even from one person, and collapsing them reads as one.
const GROUP_WINDOW_MS = 5 * 60 * 1000

function sameDay(a: number, b: number): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}

// Insert day separators and mark same-sender continuations.
//
// A SECOND pass over the folded items rather than logic inside the fold: the
// fold decides what exists, this decides how it is laid out, and keeping them
// apart is why every Wave 2 decoration survives grouping untouched.
export function applyLayout(items: TimelineItem[]): TimelineItem[] {
  const out: TimelineItem[] = []
  // The last item, for the day boundary.
  let prev: TimelineItem | null = null
  // The last item a run can continue FROM, which is not the same thing: a
  // membership row has no sender pill, so it can neither continue a run nor
  // anchor one. Were it allowed to anchor, a message following a join from the
  // same person would hide its pill and appear to belong to the join line.
  let anchor: TimelineItem | null = null

  for (const item of items) {
    const ts = item.event.getTs()

    if (!prev || !sameDay(prev.event.getTs(), ts)) {
      out.push({
        event: item.event,
        kind: 'day',
        // Distinct from any event id, and stable across rebuilds.
        id: `day-${new Date(ts).toDateString()}`,
        content: {},
        dayTs: ts,
      })
      // A day break always starts a new run, whoever sent it.
      out.push({ ...item, showHeader: true })
      prev = item
      anchor = item.kind === 'member' ? null : item
      continue
    }

    if (item.kind === 'member') {
      out.push({ ...item, showHeader: true })
      prev = item
      anchor = null
      continue
    }

    const continues =
      !!anchor &&
      anchor.event.getSender() === item.event.getSender() &&
      ts - anchor.event.getTs() < GROUP_WINDOW_MS &&
      // A reply opens a new thought: hiding the sender above a reply pill
      // reads as the pill belonging to the message before it.
      !item.replyTo &&
      anchor.kind !== 'day'

    out.push({ ...item, showHeader: !continues })
    prev = item
    anchor = item
  }

  return out
}

export interface ToItemsOptions {
  // Needed to mark own reactions and to find the annotation to redact when
  // toggling one off.
  myUserId?: string | null
  // W4.4 -- senders whose events are hidden. The server stops sending an
  // ignored user's events, but NOT retroactively: anything already in a loaded
  // timeline stays, so the renderer has to filter too.
  ignoredUsers?: readonly string[]
  // Show the events that exist so the room works rather than to be read
  // (isSystemEvent). Off by default: they render as a literal `[type]` row that
  // costs height and splits a cluster, and nobody has ever wanted to see one.
  showSystemEvents?: boolean
}

function classify(ev: MatrixEvent): TimelineItemKind {
  if (ev.isRedacted()) return 'redacted'
  // ONLY events we could not decrypt render as the padlock.
  //
  // The obvious test is wrong, and was wrong here until E5. `isEncrypted()`
  // reads the WIRE type, so it stays true forever after a SUCCESSFUL
  // decryption -- meaning every decrypted message would have kept rendering as
  // "Encrypted", with the SDK insisting decryption worked. `getType()` is the
  // opposite: it returns the CLEAR type once decrypted, so it stops saying
  // `m.room.encrypted` at exactly the right moment.
  //
  // So: a decryption failure is a padlock; an event still in flight is a
  // padlock; a decrypted event is simply its own kind.
  if (ev.isDecryptionFailure() || ev.isBeingDecrypted()) return 'encrypted'
  if (ev.getType() === 'm.room.encrypted') return 'encrypted'
  if (ev.getType() === 'm.room.message') return 'message'
  // Without this these fall through to the unknown-type branch and render as
  // the literal string `[m.room.member]`.
  if (ev.getType() === 'm.room.member') return 'member'
  return 'other'
}

interface GalleryTag {
  id: string
  index?: number
  count?: number
  layout?: GalleryLayout
}

// Parse the composer's batch hint off a gallery-tagged m.image, or null.
function galleryTag(ev: MatrixEvent): GalleryTag | null {
  if (ev.isRedacted()) return null
  if (ev.getType() !== 'm.room.message') return null
  const c = ev.getContent()
  if (c.msgtype !== 'm.image') return null
  const g = c['net.41chan.gallery']
  if (!g || typeof g !== 'object') return null
  const id = (g as { id?: unknown }).id
  if (typeof id !== 'string') return null
  const index = (g as { index?: unknown }).index
  const count = (g as { count?: unknown }).count
  const layout = (g as { layout?: unknown }).layout
  return {
    id,
    index: typeof index === 'number' ? index : undefined,
    count: typeof count === 'number' ? count : undefined,
    layout:
      layout === 'grid' || layout === 'stack' || layout === 'strip' ? layout : undefined,
  }
}

export function toItems(events: MatrixEvent[], opts: ToItemsOptions = {}): TimelineItem[] {
  const out: TimelineItem[] = []
  const consumed = new Set<string>()
  const ignored = opts.ignoredUsers?.length ? new Set(opts.ignoredUsers) : null
  const rel = buildRelationIndex(events, opts.myUserId)

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    const evId = ev.getId() ?? ''
    if (!evId || consumed.has(evId)) continue
    // Dropped before anything else looks at it, so a hidden system event cannot
    // break a sender cluster in two or strand a day separator above nothing.
    if (!opts.showSystemEvents && isSystemEvent(ev.getType())) continue
    // Edits and reactions modify another event; they are never rows of their
    // own. Without this they render as duplicate messages and `[m.reaction]`
    // junk -- which is exactly what the client does today.
    if (isRelationOnlyEvent(ev)) continue
    // Filtered here rather than in the renderer so an ignored sender leaves no
    // gap, no "message hidden" row, and no reaction or receipt behind.
    if (ignored && ignored.has(ev.getSender() ?? '')) continue
    // Spatial-mode presence/position events ride the timeline (so they work at
    // PL0) but are never chat -- keep them out of every message log.
    if (ev.getType().startsWith('net.41chan.spatial.')) continue
    // Chat interactions (a slap, a wave) are ephemeral animations played by the
    // overlay, not things anyone said. Without this they render as
    // `[net.41chan.interaction]` rows, and a lively room's history becomes
    // unreadable as conversation (D-in04).
    if (ev.getType() === INTERACTION_EVENT) continue
    // Bridge tag writes are STATE events, but state events also travel down the
    // timeline -- without this they render as `[net.41chan.media.tags]` junk
    // rows between messages. The tag store reads them from the same stream.
    if (ev.getType() === MEDIA_TAGS_EVENT) continue
    // A background is POSTED so the media gate can authorize it (the gate
    // authorizes media with a message behind it), but it is wallpaper, not
    // something someone said -- so it stays out of the chat log.
    if (isBackgroundPost(ev.getOriginalContent())) continue

    const tag = galleryTag(ev)
    if (tag) {
      // Gather every member of this batch across the whole window (not just the
      // consecutive run), so interleaved/out-of-order images still land in-grid.
      const members = events.filter((e) => galleryTag(e)?.id === tag.id)

      // Grid size = declared count, expanded to fit any present index / overflow.
      let size = tag.count && tag.count >= 1 ? tag.count : 0
      for (const m of members) {
        const mi = galleryTag(m)?.index
        if (typeof mi === 'number' && mi + 1 > size) size = mi + 1
      }
      if (members.length > size) size = members.length

      if (size >= 2) {
        for (const m of members) {
          const mid = m.getId()
          if (mid) consumed.add(mid)
        }
        const cells: (MatrixEvent | null)[] = new Array(size).fill(null)
        for (const m of members) {
          const mi = galleryTag(m)?.index
          let slot = typeof mi === 'number' ? mi : -1
          if (slot < 0 || slot >= size || cells[slot] !== null) {
            slot = cells.findIndex((c) => c === null) // fallback: first free slot
          }
          if (slot >= 0) cells[slot] = m
        }
        out.push({
          event: ev,
          kind: 'gallery',
          id: evId,
          cells,
          layout: tag.layout ?? 'grid',
          content: ev.getOriginalContent(),
        })
        continue
      }
    }

    const kind = classify(ev)
    const edit = rel.edits.get(evId)
    const item: TimelineItem = {
      event: ev,
      kind,
      id: evId,
      content: effectiveContent(ev, edit),
    }
    // A redacted event has no content left to decorate, and its reactions are
    // gone with it.
    if (kind !== 'redacted') {
      if (edit) item.editedTs = edit.ts
      const reactions = rel.reactions.get(evId)
      if (reactions && reactions.length > 0) item.reactions = reactions
      const replyTo = resolveReply(ev, rel.byId)
      if (replyTo) item.replyTo = replyTo
    }
    out.push(item)
  }

  return out
}

// Depth a freshly-opened room back-fills to (sync alone delivers ~20).
const INITIAL_SCROLLBACK = 60

// Live timeline for a room: current events, live appends, and scrollback.
export function useTimeline(client: MatrixClient | null, room: Room | null) {
  const [items, setItems] = useState<TimelineItem[]>([])
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [atStart, setAtStart] = useState(false)
  const roomRef = useRef<Room | null>(null)
  // Read here rather than inside refresh: it is the reason to rebuild, so it
  // belongs in the dependency list and not in a closure that never sees it
  // change.
  const showSystemEvents = useShowSystemEvents()

  // Rebuild the item list from the room's current live timeline.
  const refresh = useCallback(() => {
    if (!room) {
      setItems([])
      return
    }
    const myUserId = client?.getUserId() ?? null
    setItems(
      applyLayout(
        toItems(room.getLiveTimeline().getEvents(), {
          showSystemEvents,
          myUserId,
          ignoredUsers: client ? getIgnoredUsers(client) : undefined,
        }),
      ),
    )
  }, [client, room, showSystemEvents])

  useEffect(() => {
    roomRef.current = room
    let cancelled = false
    // Relation traffic is bursty -- a single message can draw a dozen
    // reactions inside one sync. Coalesce a burst into ONE rebuild on the next
    // macrotask instead of rebuilding the whole window per event. Driven from
    // handlers and timeouts only, so no setState lands in an effect body
    // (G-tc01).
    let pending: ReturnType<typeof setTimeout> | null = null
    const scheduleRefresh = () => {
      if (pending !== null) return
      pending = setTimeout(() => {
        pending = null
        if (!cancelled) refresh()
      }, 0)
    }
    // Reset the view for the new room off the effect body (a microtask, so it's
    // not a synchronous setState-in-effect but still lands the same frame).
    queueMicrotask(() => {
      if (cancelled) return
      refresh()
      setAtStart(false)
    })
    if (!client || !room) return

    // Deepen a shallow initial view once per room open, so a fresh room
    // shows real history without the user clicking for it.
    if (room.getLiveTimeline().getEvents().length < INITIAL_SCROLLBACK) {
      client
        .scrollback(room, INITIAL_SCROLLBACK)
        .then(() => {
          if (!cancelled) refresh()
        })
        .catch((err) => reportIgnored('timeline: initial scrollback', err))
    }

    // Fire on any timeline change in THIS room (new messages, etc.).
    const onTimeline = (_ev: MatrixEvent, evRoom: Room | undefined) => {
      if (evRoom?.roomId === roomRef.current?.roomId) scheduleRefresh()
    }
    // A redaction removes a message OR takes back a reaction. Both change what
    // toItems produces, and neither necessarily emits a Timeline event.
    const onRedaction = (_ev: MatrixEvent, evRoom: Room | undefined) => {
      if (evRoom?.roomId === roomRef.current?.roomId) scheduleRefresh()
    }
    // Local echo -> real event: the event id changes, which is exactly the id
    // our own-reaction toggle needs to redact by.
    const onLocalEcho = (_ev: MatrixEvent, evRoom: Room | undefined) => {
      if (evRoom?.roomId === roomRef.current?.roomId) scheduleRefresh()
    }
    // A gappy sync swaps the live timeline object out from under us; without
    // this the view keeps rendering a timeline the room no longer owns.
    const onReset = (evRoom: Room | undefined) => {
      if (evRoom?.roomId === roomRef.current?.roomId) scheduleRefresh()
    }
    // The ignore list is account data; changing it must repaint immediately
    // rather than waiting for the next message.
    const onAccountData = () => scheduleRefresh()
    client.on(ClientEvent.AccountData, onAccountData)
    client.on(RoomEvent.Timeline, onTimeline)
    client.on(RoomEvent.Redaction, onRedaction)
    client.on(RoomEvent.LocalEchoUpdated, onLocalEcho)
    client.on(RoomEvent.TimelineReset, onReset)
    return () => {
      cancelled = true
      if (pending !== null) clearTimeout(pending)
      client.off(ClientEvent.AccountData, onAccountData)
      client.off(RoomEvent.Timeline, onTimeline)
      client.off(RoomEvent.Redaction, onRedaction)
      client.off(RoomEvent.LocalEchoUpdated, onLocalEcho)
      client.off(RoomEvent.TimelineReset, onReset)
    }
  }, [client, room, refresh])

  // Load a page of older events (scrollback). Resolves when done.
  const loadOlder = useCallback(async () => {
    if (!client || !room || loadingOlder || atStart) return
    setLoadingOlder(true)
    try {
      const before = room.getLiveTimeline().getEvents().length
      await client.scrollback(room, 30)
      const after = room.getLiveTimeline().getEvents().length
      refresh()
      // No new events came back -> we've reached the start of the room.
      if (after === before) setAtStart(true)
    } finally {
      setLoadingOlder(false)
    }
  }, [client, room, loadingOlder, atStart, refresh])

  return { items, loadOlder, loadingOlder, atStart }
}
