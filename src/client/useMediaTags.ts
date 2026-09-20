import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { RoomEvent, RoomStateEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk'
import { parseMxc } from './media'
import { createLimiter } from './concurrency'
import { reportIgnored } from './report'
import { ensureBooruSession } from './booruSession'
import {
  fetchBooruProvenance,
  fetchBooruTags,
  withProvenance,
  writeBooruTags,
  type TagEdit,
} from './booruTags'
import { mayRead, mergeBooruIntoSet, newBooruReadState, optimisticSet } from './booruLive'
import {
  MEDIA_TAGS_EVENT,
  mediaIdFromStateKey,
  parseTagContent,
  tagSetFromEvent,
  type MediaTagSet,
} from './mediaTags'

// ---------------------------------------------------------------------------
// The live media-tag store. Tags arrive as room state, so they are already
// REALTIME over sync -- there is no polling here and none is wanted. What the
// "pulse" buys us is COALESCING: a bridge backfilling a room writes tags for
// dozens of images in one burst, and without a gate that is one render per
// event. Changes are batched and flushed on a ~250ms tick (the D1 debounce
// precedent), so a burst costs one render pass.
//
// Keyed by MEDIA ID, not by (roomId, eventId): tags describe the media itself,
// so the same image posted into three rooms resolves from one entry. That is
// also what lets the lightbox, the thread list, and the domain canvas look tags
// up without any of them knowing which room the image came from.
//
// Per-image subscriptions (useSyncExternalStore) mean a tag arriving for ONE
// image re-renders that image's strip only -- not every image on screen.
// ---------------------------------------------------------------------------

const FLUSH_MS = 250

type Listener = () => void

const sets = new Map<string, MediaTagSet>()
const listeners = new Map<string, Set<Listener>>()
const globalListeners = new Set<Listener>()
const dirty = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | undefined

function notify(): void {
  for (const mediaId of dirty) {
    const subs = listeners.get(mediaId)
    if (subs) for (const cb of subs) cb()
  }
  dirty.clear()
  for (const cb of globalListeners) cb()
}

function scheduleFlush(): void {
  if (flushTimer !== undefined) return
  flushTimer = setTimeout(() => {
    flushTimer = undefined
    notify()
  }, FLUSH_MS)
}

// Apply one parsed set. Older writes never clobber newer ones (state can arrive
// out of order across a gappy sync).
function ingestSet(next: MediaTagSet | null, mediaId: string): void {
  const prev = sets.get(mediaId)
  if (!next) {
    if (!prev) return
    sets.delete(mediaId)
  } else {
    if (prev && prev.ts > next.ts) return
    sets.set(mediaId, next)
  }
  dirty.add(mediaId)
  scheduleFlush()
}

function ingestEvent(ev: MatrixEvent): void {
  if (ev.getType() !== MEDIA_TAGS_EVENT) return
  const mediaId = mediaIdFromStateKey(ev.getStateKey())
  if (!mediaId) return
  ingestSet(tagSetFromEvent(ev), mediaId)
  // Seen for real -- drop any "known absent" mark so a later miss re-fetches.
  for (const key of [...missing]) {
    if (key.endsWith('|' + mediaId)) missing.delete(key)
  }
  // A push means somebody retagged, so whatever this event carried, the live
  // set is now the truth: ignore the TTL and read it again.
  //
  // ONLY FOR AN IMAGE SOMETHING IS CURRENTLY RENDERING. `listeners` has an
  // entry exactly while a panel or chip for this image is mounted, and that
  // bound is the whole reason this is safe: one measured bridge backfill wrote
  // 718 tag events in a single batch, and reacting to each of them
  // unconditionally would have been 718 booru reads for images nobody was
  // looking at.
  if (listeners.has(mediaId)) refreshBooruTags(mediaId, true)
}

// Full sweep of every room. Reads BOTH sources:
//
//  - currentState, the canonical home, and
//  - the loaded timeline, which carries the same state event when it is
//    written live.
//
// currentState is now the COMPLETE and CURRENT source: net.41chan.media.tags
// is listed in required_state, so sync delivers the latest value for every
// tagged image in every joined room. That is what makes a month-old image show
// its current tags rather than the ones it was born with.
//
// The timeline read stays for two reasons: a live write reaches it first, and
// an event scrolled into view is free to ingest. It cannot make anything
// stale -- ingestSet refuses a write older than the one it holds -- so an old
// tag event surfacing during scrollback loses to the current value already in
// the store. `fetchTags` below still closes the gap for a room this client has
// not synced state for.
function scanAll(client: MatrixClient): void {
  for (const room of client.getRooms()) {
    for (const ev of room.currentState.getStateEvents(MEDIA_TAGS_EVENT)) {
      ingestEvent(ev)
    }
    for (const ev of room.getLiveTimeline().getEvents()) {
      if (ev.getType() === MEDIA_TAGS_EVENT) ingestEvent(ev)
    }
  }
}

// ---------------------------------------------------------------------------
// On-demand fetch. The authoritative path: asks the homeserver for one image's
// state event directly, bypassing sync entirely. This is what makes tags work
// for an image from any point in history -- the thread list showing a year-old
// thread root, or a lightbox opened on a scrolled-back image -- without asking
// sliding sync to carry every tag event in the room.
//
// `missing` is a negative cache: a 404 means "this image has no tags", and
// without remembering that, every render of an untagged image re-requests it.
// ---------------------------------------------------------------------------

const inFlight = new Set<string>()
const missing = new Set<string>()

let fetchClient: MatrixClient | null = null

export function fetchTags(roomId: string, mxc: string): void {
  const mediaId = parseMxc(mxc)?.mediaId
  if (!fetchClient || !mediaId) return
  if (sets.has(mediaId)) return
  const key = roomId + '|' + mediaId
  if (inFlight.has(key) || missing.has(key)) return
  inFlight.add(key)

  // getStateEvent is typed to known event names and uses `this` internally, so
  // reach the custom type through a bound, loosely-typed alias (cf. G-bf03).
  const get = fetchClient.getStateEvent.bind(fetchClient) as unknown as (
    roomId: string,
    eventType: string,
    stateKey: string,
  ) => Promise<Record<string, unknown>>

  // The bridge keys state by the FULL mxc uri, so ask for it that way.
  get(roomId, MEDIA_TAGS_EVENT, mxc)
    .then((content) => {
      inFlight.delete(key)
      ingestSet(parseTagContent(content, mediaId, Date.now()), mediaId)
    })
    .catch(() => {
      // 404 (no tags for this image) or 403 (cannot read state) -- either way,
      // stop asking. A live write for this image clears the mark.
      inFlight.delete(key)
      missing.add(key)
    })
}

// ---------------------------------------------------------------------------
// The live read. Matrix supplies the POINTER (post_id); the booru supplies the
// tags, for the images actually on screen.
//
// Capped through the same LIFO limiter the pictures use, for the same reason
// and with one extra: LIFO means the image that just scrolled in is served
// before the one scrolled past, and the cap means a room whose whole first page
// is pictures cannot open forty connections to the booru at once. Each read is
// about 157 bytes measured against production, so the cost that matters here is
// the REQUEST COUNT, not the bytes.
//
// Nothing here polls. A read happens when an image comes into view, and again
// when the bridge says the tags changed.
// ---------------------------------------------------------------------------

const BOORU_MAX_INFLIGHT = 4

const booruLimiter = createLimiter(BOORU_MAX_INFLIGHT)
const booruReads = newBooruReadState()

/**
 * Pull this image's CURRENT tags from the booru and let them win.
 *
 * Safe to call on every render and every scroll: mayRead refuses a duplicate
 * in-flight read and a repeat inside the TTL. `force` skips the TTL only, and
 * is what a state push uses.
 *
 * Silent when the image has no post_id -- that is an image the booru does not
 * know about, and there is nothing to ask it.
 */
export function refreshBooruTags(mediaId: string, force = false): void {
  const postId = sets.get(mediaId)?.postId
  if (postId === undefined) return
  if (!mayRead(booruReads, postId, Date.now(), force)) return

  booruReads.inFlight.add(postId)
  // Marked ASKED at the start, not at the end. Marking on completion would let
  // a slow or failing booru be re-asked by every render that happens while the
  // first read is still out -- the in-flight set catches that, but only until
  // the failure clears it, and then the whole TTL would restart from a request
  // that never landed.
  booruReads.askedAt.set(postId, Date.now())

  void booruLimiter
    .run(async () => {
      // TWO READS, ONE SLOT. Category comes off the post, provenance off the
      // sidecar, and they are different questions -- but they are one
      // logical refresh, so they share a limiter slot rather than competing
      // for two. Together they are well under a kilobyte.
      //
      // Provenance is allowed to fail on its own: a post with no sidecar
      // rows, or a booru that refuses that endpoint, must still show tags.
      // The pill then falls back to its category colour, which is what
      // shipped before provenance existed.
      const live = await fetchBooruTags(postId)
      if (!live) return null
      let who = null
      try {
        who = await fetchBooruProvenance(postId)
      } catch (err) {
        reportIgnored('media tags: provenance for booru post ' + postId, err)
      }
      return who ? { ...live, tags: withProvenance(live.tags, who) } : live
    })
    .then((live) => {
      if (!live) return
      // Re-read the store rather than closing over the earlier set: the read
      // took a round trip, and a state push may have replaced it meanwhile.
      const current = sets.get(mediaId)
      if (!current) return
      ingestSet(mergeBooruIntoSet(current, live, Date.now()), mediaId)
    })
    .catch((err: unknown) => {
      // A booru that is down, challenged, or refusing must not take the tag
      // panel with it -- the Matrix copy stays on screen, which is exactly what
      // shipped before this existed. The TTL is the backoff.
      //
      // BUT IT IS RECORDED. This was a bare `catch (){}`, and that is why a
      // CORS misconfiguration ran for days with no trace anywhere: every live
      // read was rejected by the browser, the panel kept drawing the stale
      // Matrix copy, and the only symptom was tags that looked slightly old.
      // Continuing past a failure is a choice; making the choice invisible is
      // not part of it. Deduped per post, so a booru that is down does not
      // flood the console once per scroll.
      reportIgnored('media tags: live read for booru post ' + postId, err)
    })
    .finally(() => {
      booruReads.inFlight.delete(postId)
    })
}

// ---------------------------------------------------------------------------
// The write. Same pointer, the other direction.
//
// OPTIMISTIC, because the whole point of the interaction is that it feels
// immediate: the pill is in the panel before the request leaves, and
// useTagDiff pops it exactly as it pops one that arrived from somebody else.
// The server answer then REPLACES the guess rather than confirming it, so a
// tag that turns out to be a character recolours a moment later and a tag the
// booru rewrote (an alias -- anus becomes butthole) shows its real name.
//
// A FAILED EDIT MUST NOT LEAVE A LIE ON SCREEN. The optimistic set is rolled
// back and a live read is forced: a 403 means nothing changed, but a 5xx is
// genuinely ambiguous and guessing which one it was is how a panel ends up
// permanently disagreeing with the booru. 157 bytes settles it.
// ---------------------------------------------------------------------------

/**
 * Add or remove tags on the image's booru post.
 *
 * Resolves when the booru has agreed and the store holds its answer; REJECTS
 * with a message naming its own remedy, after the optimistic change has been
 * rolled back. Callers surface that text -- it is the only place the user
 * learns the booru refused them.
 */
export async function editBooruTags(mediaId: string, edit: TagEdit): Promise<void> {
  const before = sets.get(mediaId)
  const postId = before?.postId
  if (!before || postId === undefined) {
    throw new Error(
      'this image has no booru post, so there is nothing to tag. ' +
        'Fix: it reaches the booru through the bridge; an image posted directly to ' +
        'Matrix has no post to edit.',
    )
  }

  // old_tag_string is what the SERVER last said, and it is what makes the write
  // a delta instead of an overwrite. A set assembled from Matrix alone has
  // never seen the server, so read once -- and only in that case.
  let seen = before.tagString
  if (seen === undefined) {
    const live = await booruLimiter.run(() => fetchBooruTags(postId))
    if (!live) {
      throw new Error(
        `could not read post ${postId} from the booru, so an edit would overwrite ` +
          'rather than amend. Fix: check the booru session (a 403 is usually the ' +
          'Cloudflare challenge or a signed-out booru cookie) and try again.',
      )
    }
    const current = sets.get(mediaId)
    if (current) ingestSet(mergeBooruIntoSet(current, live, Date.now()), mediaId)
    seen = live.tagString
  }

  // Snapshot AFTER the read above, so a rollback restores what was really on
  // screen when the edit was made rather than a set two steps stale.
  const base = sets.get(mediaId) ?? before
  ingestSet(optimisticSet(base, edit, Date.now()), mediaId)

  try {
    const after = await booruLimiter.run(() => writeBooruTags(postId, seen, edit))
    // The write answered with the post's real tags, so the TTL starts here: a
    // panel still on screen must not immediately spend a read re-asking what it
    // was just told.
    booruReads.askedAt.set(postId, Date.now())
    if (after) {
      const current = sets.get(mediaId)
      if (current) ingestSet(mergeBooruIntoSet(current, after, Date.now()), mediaId)
    }
  } catch (err) {
    ingestSet({ ...base, ts: Date.now() }, mediaId)
    refreshBooruTags(mediaId, true)
    throw err
  }
}

function subscribeTo(mediaId: string, cb: Listener): () => void {
  let subs = listeners.get(mediaId)
  if (!subs) {
    subs = new Set()
    listeners.set(mediaId, subs)
  }
  subs.add(cb)
  return () => {
    subs.delete(cb)
    if (subs.size === 0) listeners.delete(mediaId)
  }
}

// Mount ONCE, near the app root: wires the store to the client. Everything else
// in the tree reads through useMediaTags(mxc) and needs no props threaded to it.
export function useMediaTagSync(client: MatrixClient | null): void {
  useEffect(() => {
    if (!client) return
    fetchClient = client
    scanAll(client)

    // The live read is credentialed, so the booru applies the VIEWER's own
    // visibility rather than handing an anonymous client a quietly reduced
    // answer. Memoised per token, so this costs one request even though
    // BooruFrame asks for the same thing whenever it mounts.
    void ensureBooruSession(client.getAccessToken() ?? null)

    // Both channels: state writes that sync surfaces as state, AND the same
    // events arriving down the timeline (the only path that currently fires,
    // given the lean required_state).
    const onState = (ev: MatrixEvent) => ingestEvent(ev)
    const onTimeline = (ev: MatrixEvent) => ingestEvent(ev)
    client.on(RoomStateEvent.Events, onState)
    client.on(RoomEvent.Timeline, onTimeline)
    return () => {
      client.off(RoomStateEvent.Events, onState)
      client.off(RoomEvent.Timeline, onTimeline)
      fetchClient = null
      if (flushTimer !== undefined) {
        clearTimeout(flushTimer)
        flushTimer = undefined
      }
    }
  }, [client])
}

// Tags for one image, by mxc. Re-renders only this consumer when THIS image's
// tags change. Pass `roomId` where the caller knows it: that enables the
// on-demand fetch, which is what makes tags resolve for images whose tag event
// is outside the loaded timeline.
export function useMediaTags(mxc: string | undefined, roomId?: string): MediaTagSet | undefined {
  const mediaId = mxc ? (parseMxc(mxc)?.mediaId ?? '') : ''

  // Ask the homeserver only for images we have nothing for. Cheap and idempotent
  // -- fetchTags self-dedupes on in-flight, cached, and known-absent.
  useEffect(() => {
    if (mxc && roomId) fetchTags(roomId, mxc)
  }, [mxc, roomId])

  const subscribe = useCallback(
    (cb: Listener) => {
      if (!mediaId) return () => {}
      return subscribeTo(mediaId, cb)
    },
    [mediaId],
  )

  const getSnapshot = useCallback(() => (mediaId ? sets.get(mediaId) : undefined), [mediaId])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// Count only -- for surfaces that show a chip instead of a strip. Subscribes the
// same way, so a thumbnail's chip ticks up live.
export function useMediaTagCount(mxc: string | undefined, roomId?: string): number {
  return useMediaTags(mxc, roomId)?.tags.length ?? 0
}
