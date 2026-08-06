import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { RoomEvent, RoomStateEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk'
import { parseMxc } from './media'
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
}

// Full sweep of every room. Reads BOTH sources:
//
//  - currentState, the canonical home, and
//  - the loaded timeline, because under sliding sync `required_state` is lean
//    (room chrome + $ME) and custom state types are NEVER delivered in the
//    state block. The state event still travels down the TIMELINE when it is
//    written live, which is the only reason tags appear at all today.
//
// Neither source is complete on its own: the timeline only carries writes that
// happened inside the loaded window, and currentState only carries what sync
// chose to send. `fetchTags` below closes the gap on demand.
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
