import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { RoomEvent, RoomStateEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk'
import { fetchMediaSrc, parseMxc } from './media'
import { isBooruMxc } from './booruRef'
import { createLimiter } from './concurrency'
import { reportIgnored } from './report'
import { ensureBooruSession, renewOnReturn } from './booruSession'
import {
  applyBlocklistEdit,
  applyBlocklistRead,
  beginBlocklistRead,
  blockedBy,
  clearBlocklist,
  currentRules,
  editQueue,
  fetchBlocklist,
  onBlocklistChanged,
  postWords,
  sendBlocklistEdit,
  setBlocked,
  type BlocklistOp,
  type CompiledRule,
} from './booruBlocklist'
import {
  fetchBooruPool,
  writeBooruTags,
  JAILED,
  WITHHELD,
  type TagEdit,
} from './booruTags'
import { jail, popPhase, recheckSoon, release, setRechecker, withhold } from './withheldMedia'
import { mediaOnScreen } from './onScreenMedia'
import { mayRead, mergeBooruIntoSet, newBooruReadState, optimisticSet } from './booruLive'
import { askKey, beginAsk, heardOf, isAbsent, newTagAsks, retry, settle, tagLineView, takeDeferred, type TagLineView } from './tagAsks'
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
  judge(mediaId)
  dirty.add(mediaId)
  scheduleFlush()
}

// Does the person's booru blocklist hide this picture (booruBlocklist.ts)?
// Judged on whatever tags this store holds for it -- the ones the panel
// shows -- every time they change, and for every picture when the list
// changes. A picture with no tags yet matches nothing.
function judge(mediaId: string): void {
  const set = sets.get(mediaId)
  const rules = currentRules()
  if (!set || rules.length === 0 || set.tags.length === 0) {
    setBlocked(mediaId, false)
    return
  }
  setBlocked(mediaId, !!blockedBy(rules, postWords(set.tags.map((t) => t.name), set.rating)))
}
onBlocklistChanged(() => {
  for (const mediaId of sets.keys()) judge(mediaId)
})

// Read the list again this often while the window is shown. One small GET.
//
// WHEN THE LIST CAN HAVE CHANGED. The booru is edited in its own frame inside
// this window (BooruFrame), so neither focus nor visibility marks the moment.
// Leaving that frame does: BooruFrame unmounts when a room is opened, and
// rereads the list then (rereadBlocklist). Before that (2026-11-20, seen in
// Firefox) a tag blocked in the frame stayed visible in the next room: the
// return-to-window reread is spaced 60 s apart for the session's sake, so a
// quick edit fell inside the gap, and the read queued behind every tag read
// the new room started. A slower edit -- the settings page -- outlasted the
// gap, which is why removing a tag looked instant and adding one did not.
// The timer stays for an edit made in another tab.
export const BLOCKLIST_REREAD_MS = 2 * 60_000

// THE PICTURES ON SCREEN ARE ASKED AGAIN EVERY MINUTE while the tab is
// visible (operator, 2026-11-22: "Misc tag changes can be on the 60s timer
// -- jails and sensitive tags should be pushes"). An ordinary retag made by
// someone else sends nothing, so this timer is how a picture that never
// leaves the screen learns of it. A jail, a deletion or a rating change is
// pushed instead: the booru tells the tunnel, the tunnel rewrites the
// picture's tag state in its rooms, and ingestEvent reads it at once. Should
// a push be lost, this timer still catches the change within the minute.
export const ON_SCREEN_REREAD_MS = 60_000

// Each rule Technetium cannot apply is said ONCE, not on every re-read: a
// report every two minutes about the same rule is noise that buries the next
// real fault.
const reportedUnseen = new Set<string>()

/**
 * Read the person's blocklist now and apply it. Called on leaving the booru
 * view (BooruFrame), where the list is edited.
 *
 * NOT through booruLimiter. That queue is LIFO so the picture scrolled in
 * last is served first; a read started as a room opens is exactly the one
 * every picture of that room then overtakes. This is one small GET, not part
 * of a flood.
 */
export function rereadBlocklist(): Promise<void> {
  // Signed out (the frame unmounts then too): there is no list to read, and
  // asking would only record a refused exchange.
  if (!fetchClient) return Promise.resolve()
  return loadBlocklist()
}

function reportUnseen(unseen: readonly CompiledRule[] | null): void {
  for (const r of unseen ?? []) {
    if (reportedUnseen.has(r.rule)) continue
    reportedUnseen.add(r.rule)
    reportIgnored(
      'blocklist rule "' + r.rule + '"',
      new Error(
        'it names ' + r.unseen.join(' ') + ', which the live read does not carry, so ' +
          'Technetium does not apply this rule; the booru still does. Fix: write the ' +
          'rule with tags and rating only to have it apply here too.',
      ),
    )
  }
}

// Edits go one at a time, in the order they were made (editQueue says why).
const queueEdit = editQueue()

/**
 * Edit the person's blocklist on the booru (BlocklistControl) and apply the
 * list it answers with, which judges every known picture again at once
 * (onBlocklistChanged). Rejects with the booru's own words on a refusal
 * (BlocklistRefused) for the panel to show; nothing is changed here first,
 * so a refused edit leaves the list exactly as it was.
 */
export function editBlocklist(op: BlocklistOp, rule: string): Promise<void> {
  const run = async () => {
    const client = fetchClient
    if (!client) throw new Error('signed out, so there is no booru account to edit. Fix: sign in again.')
    const next = await withBooruSession(() => sendBlocklistEdit(op, rule))
    // Signed out or switched account while the answer was on its way: that
    // account's list must not come back for whoever is signed in now.
    if (fetchClient !== client) return
    reportUnseen(applyBlocklistEdit(next))
  }
  return queueEdit(run)
}

function loadBlocklist(): Promise<void> {
  const read = beginBlocklistRead()
  return withBooruSession(() => fetchBlocklist())
    .then((blocks) => {
      reportUnseen(applyBlocklistRead(read, blocks))
    })
    .catch((err: unknown) => {
      // Recorded, and the last list read stays in force: a booru that is down
      // for a minute must not bring back every blocked picture.
      reportIgnored('blocklist: read from the booru', err)
    })
}

function ingestEvent(ev: MatrixEvent): void {
  if (ev.getType() !== MEDIA_TAGS_EVENT) return
  const mediaId = mediaIdFromStateKey(ev.getStateKey())
  if (!mediaId) return
  rememberMxc(ev.getStateKey(), mediaId)
  ingestSet(tagSetFromEvent(ev), mediaId)
  // Seen for real -- drop any "no tags" or "could not load" on record for it.
  heardOf(asks, mediaId)
  // A push means somebody retagged, so whatever this event carried, the live
  // set is now the truth: ignore the TTL and read it again.
  //
  // ONLY FOR AN IMAGE SOMETHING IS CURRENTLY RENDERING. `listeners` has an
  // entry exactly while a panel or chip for this image is mounted, and that
  // bound is the whole reason this is safe: one measured bridge backfill wrote
  // 718 tag events in a single batch, and reacting to each of them
  // unconditionally would have been 718 booru reads for images nobody was
  // looking at.
  //
  // And for a picture that popped out of the room (withheldMedia.ts): it has
  // no listener, because its row is gone, and a push for it -- a quarantine
  // let go, a replaced file -- is the soonest word that it may come back.
  // A jailed picture's placeholder mounts no tag panel either, so it is asked
  // on the same terms: the push is how a release reaches an open room.
  const phase = popPhase(mediaId)
  if (listeners.has(mediaId) || phase === 'gone' || phase === 'jailed') refreshBooruTags(mediaId, true)
}

// The full mxc of each image the store has heard of, for bringing a popped
// picture back (bringBack): its tags are keyed by media id alone. Filled
// wherever the mxc is in hand -- the bridge's state key, an on-demand ask.
const mxcOf = new Map<string, string>()
function rememberMxc(key: string | undefined, mediaId: string): void {
  if (key?.startsWith('mxc://') && !mxcOf.has(mediaId)) mxcOf.set(mediaId, key.trim())
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
// What has been asked and answered lives in `asks` (tagAsks.ts): a 404 is
// remembered as "no tags", so a render of an untagged image does not ask again,
// and an ask made before the client exists is parked rather than dropped.
// ---------------------------------------------------------------------------

const asks = newTagAsks()

let fetchClient: MatrixClient | null = null

export function fetchTags(roomId: string, mxc: string): void {
  const mediaId = parseMxc(mxc)?.mediaId
  if (!mediaId) return
  rememberMxc(mxc, mediaId)
  // A booru-referenced picture has no tag event on the homeserver to ask for:
  // its pointer came with its message (seedBooruRef), and asking would only
  // spend a request on a certain 404.
  if (isBooruMxc(mxc)) return
  const go = beginAsk(asks, roomId, mxc, mediaId, { haveClient: !!fetchClient, haveSet: sets.has(mediaId) })
  if (go !== 'go' || !fetchClient) return
  const key = askKey(roomId, mediaId)

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
      const set = parseTagContent(content, mediaId, Date.now())
      // An event the parser cannot read carries no tags this client can show.
      settle(asks, key, set ? 'found' : 'absent')
      if (set) ingestSet(set, mediaId)
      else changedLine(mediaId)
    })
    .catch((err: unknown) => {
      if (isAbsent(err)) {
        settle(asks, key, 'absent')
      } else {
        // Said where a report is read, and on the line itself, which offers
        // to try again (G-tc05).
        const why = err instanceof Error ? err.message : String(err)
        reportIgnored('media tags: the homeserver did not answer for ' + mxc, err)
        settle(asks, key, { failed: why })
      }
      changedLine(mediaId)
    })
}

/**
 * A booru-referenced picture (booruRef.ts) is drawn: hand the store the post
 * it names, so the live read, the blocklist and the withheld pop apply to it
 * exactly as to a bridged picture, whose pointer arrives as a state event.
 *
 * Called while the row renders, so it must stay cheap and idempotent: it
 * writes only the first time a picture is seen with this post, and that write
 * reaches React through the store's own deferred flush, never a setState
 * during render. ts 0, so the first live read always wins.
 */
export function seedBooruRef(mxc: string, postId: number): void {
  const mediaId = parseMxc(mxc)?.mediaId
  if (!mediaId || !isBooruMxc(mxc)) return
  rememberMxc(mxc, mediaId)
  if (sets.get(mediaId)?.postId === postId) return
  sets.delete(mediaId)
  ingestSet({ mediaId, tags: [], postId, ts: 0 }, mediaId)
}

// An image's line changed without its set changing (an answer of "no tags", a
// failure): its consumers re-read their state on the next flush.
function changedLine(mediaId: string): void {
  dirty.add(mediaId)
  scheduleFlush()
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
// A read happens when an image comes into view, and again when the bridge
// says the tags changed. The one schedule is for a picture that popped out of
// the room (withheldMedia.ts): nothing would ever say it may come back, so it
// is asked about again, backing off to every fifteen minutes, while the tab
// is visible.
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
/**
 * Run a booru request only once the booru session cookie exists.
 *
 * Every booru read and write is credentialed, and the booru answers one only
 * if it carries `fourier_session` (or the booru's own session): anything else
 * is met by Cloudflare's challenge -- a 403 with no CORS headers, which the
 * browser reports as a CORS error, not as a refusal. The cookie is minted by
 * the exchange (ensureBooruSession), and it is a SESSION cookie, so it is
 * gone after every browser restart, in a private window and in a fresh
 * Firefox container. Page load fired the first tag reads before the exchange
 * had answered -- scanAll runs before the exchange is even asked -- so those
 * users met a burst of CORS errors on every load (2026-09-28).
 *
 * So nothing goes to the booru until the exchange has answered for the
 * current token, and nothing at all when it refused: a refused exchange
 * (a local copy on 127.0.0.1, whose SameSite=Lax cookie the browser will not
 * accept cross-site) means every request would only be challenged. The
 * exchange is memoised per token, so this costs nothing after the first.
 */
async function withBooruSession<T>(run: () => Promise<T>): Promise<T> {
  const ok = await ensureBooruSession(fetchClient?.getAccessToken() ?? null)
  if (!ok) {
    throw new Error(
      'no booru session, so the booru was not asked (it would only answer with a ' +
        'Cloudflare challenge, which the browser reports as a CORS error). Fix: the ' +
        'exchange at booru.41chan.net/fourier/exchange refused this token or was ' +
        'unreachable; it is retried on the next token refresh. A local copy on ' +
        '127.0.0.1 never gets one, because the cookie is for .41chan.net.',
    )
  }
  return run()
}

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
    .run(() =>
      // ONE READ. This was two -- the post for categories and rating, the
      // sidecar for buckets and lamps -- asking the booru two questions per
      // image on screen to draw one panel. chanbooru's live_read answers all
      // of it from the query it was already making (chanbooru 89bdd0ac2), so
      // the second round trip bought nothing but latency and a partial-failure
      // case to handle.
      //
      // It also narrows what this client holds: the tag_string here is the
      // union of the buckets the VIEWER may see, where /posts/:id.json hands
      // out the denormalised one, private creator tags included.
      withBooruSession(() => fetchBooruPool(postId)),
    )
    .then((live) => {
      if (!live) return
      // The post is hidden from this reader, and so is its image from now on:
      // the message pops out of the room (withheldMedia.ts).
      if (live === WITHHELD) {
        withhold(mediaId)
        return
      }
      // Hidden because it is jailed: the message stays, the picture is
      // replaced by the placeholder (withheldMedia.ts, operator 2026-11-23).
      if (live === JAILED) {
        jail(mediaId)
        return
      }
      // Shown again (a sensitive tag removed, a post let out of jail): the
      // picture pops back into the room. A plain 404 above leaves it gone.
      const phase = popPhase(mediaId)
      if (phase === 'gone' || phase === 'jailed') void bringBack(mediaId)
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

// A popped picture is asked about again on withheldMedia's schedule, through
// the one live read above.
setRechecker((mediaId) => refreshBooruTags(mediaId, true))

/**
 * Ask the booru again about every picture on screen now (onScreenMedia.ts
 * says why). Forced past the TTL, because the reason to ask is that the post
 * may have changed since the last read, however recent: a jail made in the
 * booru view takes less than the TTL. Bounded by what is on screen, and each
 * read is one ~157-byte request through the same limiter.
 */
export function rereadOnScreen(): void {
  for (const mediaId of mediaOnScreen()) refreshBooruTags(mediaId, true)
}

// The booru shows a popped picture's post again. Bring it back only once the
// media gate serves the image too: the gate caches its answer (up to about
// 80 s), and a picture that pops back in only to fail to load is worse than
// one that comes back a little later. The probe is the timeline row's own
// thumbnail, so the row that mounts finds it already in the blob cache.
const ROW_THUMB = 320 // Timeline's picture row (AuthedImage width={320})
async function bringBack(mediaId: string): Promise<void> {
  const mxc = mxcOf.get(mediaId)
  if (!fetchClient || !mxc) {
    // Nothing to probe with: bring it back and let the image's own retries
    // carry a lagging gate.
    release(mediaId)
    return
  }
  try {
    const { revoke } = await fetchMediaSrc(fetchClient, mxc, ROW_THUMB)
    revoke()
    release(mediaId)
  } catch (err: unknown) {
    // Expected for a minute or so after the booru lets a post go; said where
    // a report is read all the same (G-tc05), and asked again soon.
    reportIgnored('media tags: the booru shows ' + mediaId + ' again but the media gate still refuses it; asking again shortly', err)
    recheckSoon(mediaId, Date.now())
  }
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
    const live = await booruLimiter.run(() => withBooruSession(() => fetchBooruPool(postId)))
    if (live === WITHHELD || live === JAILED) {
      if (live === JAILED) jail(mediaId)
      else withhold(mediaId)
      throw new Error(
        `booru post ${postId} is hidden from you (a sensitive, deleted or jailed post), ` +
          'so there is nothing here for you to tag. Fix: none; its picture leaves the room.',
      )
    }
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
    await booruLimiter.run(() => withBooruSession(() => writeBooruTags(postId, seen, edit)))
    // RE-READ RATHER THAN TRUST THE WRITE'S OWN ANSWER. The write replies with
    // Danbooru's post JSON, which knows nothing about buckets or lamps and
    // carries the denormalised tag_string. Ingesting it stripped every lamp
    // off the panel until the TTL expired, and put the private tags back into
    // this client's copy of tagString, undoing the narrowing the single read
    // just bought. One forced read costs a request and answers all three.
    refreshBooruTags(mediaId, true)
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
    // Every image that asked before the client existed -- on a cold start,
    // the whole first screen, since a child's effects run before App's.
    for (const a of takeDeferred(asks)) fetchTags(a.roomId, a.mxc)

    // The live read is credentialed, so the booru applies the VIEWER's own
    // visibility rather than handing an anonymous client a quietly reduced
    // answer. Memoised per token, so this costs one request even though
    // BooruFrame asks for the same thing whenever it mounts.
    void ensureBooruSession(client.getAccessToken() ?? null)

    // The person's booru blocklist, read once now and again on return and on
    // a slow timer (BLOCKLIST_REREAD_MS).
    void loadBlocklist()
    const stopRenew = renewOnReturn(loadBlocklist)
    // And the pictures on screen, on the same return and at most as often
    // (once a minute), and on their own timer (ON_SCREEN_REREAD_MS): a
    // picture that never left the screen is never asked about by scrolling
    // (onScreenMedia.ts).
    const stopReread = renewOnReturn(async () => rereadOnScreen())
    const reread = setInterval(() => {
      if (document.visibilityState === 'visible') void loadBlocklist()
    }, BLOCKLIST_REREAD_MS)
    const rereadPictures = setInterval(() => {
      if (document.visibilityState === 'visible') rereadOnScreen()
    }, ON_SCREEN_REREAD_MS)

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
      stopRenew()
      stopReread()
      clearInterval(reread)
      clearInterval(rereadPictures)
      // Signed out, or another account: its list must not outlive it, and
      // neither may a read of it still on its way.
      clearBlocklist()
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

// The line under a chat picture: the set, and what to say when there is none
// yet (tagAsks.ts tagLineView). `retry` is offered only on a failure.
export function useMediaTagLine(
  mxc: string | undefined,
  roomId?: string,
): { set: MediaTagSet | undefined; view: TagLineView; reason?: string; retry?: () => void } {
  const set = useMediaTags(mxc, roomId)
  const mediaId = mxc ? (parseMxc(mxc)?.mediaId ?? '') : ''
  const key = roomId && mediaId ? askKey(roomId, mediaId) : ''
  const subscribe = useCallback(
    (cb: Listener) => (mediaId ? subscribeTo(mediaId, cb) : () => {}),
    [mediaId],
  )
  const status = useSyncExternalStore(subscribe, () => (key ? asks.status.get(key) : undefined))
  const reason = key ? asks.reason.get(key) : undefined
  const view = tagLineView(!!set, status, !!key)
  return {
    set,
    view,
    reason: view === 'failed' ? reason : undefined,
    retry:
      view === 'failed' && roomId && mxc
        ? () => {
            retry(asks, key)
            fetchTags(roomId, mxc)
          }
        : undefined,
  }
}

// Count only -- for surfaces that show a chip instead of a strip. Subscribes the
// same way, so a thumbnail's chip ticks up live.
export function useMediaTagCount(mxc: string | undefined, roomId?: string): number {
  return useMediaTags(mxc, roomId)?.tags.length ?? 0
}
