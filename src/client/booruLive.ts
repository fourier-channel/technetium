// Live booru tags, folded into the media-tag store.
//
// WHAT MATRIX HOLDS IS A POINTER. net.41chan.media.tags carries post_id, and an
// image's md5 fixes its mxc, so that pointer is correct forever and never needs
// rewriting. The TAGS beside it are a copy, and a copy is stale the moment
// someone retags on the booru. This module is the other half of the pointer
// design: read the live set for the images actually on screen, and let it win.
//
// WHY THE POLICY IS ITS OWN FUNCTION. The cost of getting this wrong is not a
// wrong pixel, it is a request storm -- a bridge backfill wrote 718 tag events
// in one batch, and a refresh rule that reacted to each of them would have
// turned that into 718 booru reads. So the rule lives here, in one pure
// function a check can drive with a clock it controls, rather than scattered
// across an effect where the only way to test it is to watch the network tab.
//
// THE MERGE KEEPS THE POINTER AND REPLACES THE COPY. Everything that describes
// where the image came from -- postId, source, updatedBy -- is Matrix's and
// survives. Tags and rating are the booru's and are overwritten, including with
// nothing: a post whose tags were all removed must come back empty, or a
// detagging never shows up and the panel quietly disagrees with the booru
// forever.
import type { BooruTagSet } from './booruTags'
import type { MediaRating, MediaTagSet } from './mediaTags'

/**
 * How long a live read stands before the same post is asked again.
 *
 * This is a FLOOR ON REQUESTS, not a freshness promise: a real change arrives
 * as a state push from the bridge, which clears the mark and re-reads at once
 * (see refreshBooruTags). So the TTL only bounds what re-entering the viewport
 * can cost -- scrolling one image past the fold and back is free, and coming
 * back to it a minute later is one 157-byte request.
 */
export const BOORU_TTL_MS = 30_000

const RATINGS: readonly string[] = ['g', 's', 'q', 'e']

/** The booru sends the single-letter form; anything else is not a rating. */
export function asRating(v: string | undefined): MediaRating | undefined {
  return typeof v === 'string' && RATINGS.includes(v) ? (v as MediaRating) : undefined
}

/** Bookkeeping for the refresh policy, keyed by booru post id. */
export interface BooruReadState {
  /** Posts with a read in flight right now. */
  inFlight: Set<number>
  /** post id -> when it was last ASKED, successfully or not. */
  askedAt: Map<number, number>
}

export function newBooruReadState(): BooruReadState {
  return { inFlight: new Set(), askedAt: new Map() }
}

/**
 * May this post be read from the booru right now?
 *
 * Three refusals, in the order they matter:
 *   - already in flight: a second render of the same image must not duplicate
 *     the request the first one started;
 *   - asked too recently: the TTL above;
 *   - `force`, which skips only the TTL and never the in-flight check, because
 *     a state push saying "this changed" is a reason to ignore the clock and
 *     never a reason to run two reads at once.
 */
export function mayRead(state: BooruReadState, postId: number, now: number, force = false): boolean {
  if (state.inFlight.has(postId)) return false
  if (force) return true
  const asked = state.askedAt.get(postId)
  return asked === undefined || now - asked >= BOORU_TTL_MS
}

/**
 * Fold a live read into the set the store already holds.
 *
 * `now` rather than Date.now() so the caller owns the clock: the store settles
 * conflicts last-write-wins on `ts`, and a function that stamped its own time
 * could not be tested against an out-of-order arrival at all.
 */
export function mergeBooruIntoSet(prev: MediaTagSet, live: BooruTagSet, now: number): MediaTagSet {
  return {
    ...prev,
    tags: live.tags,
    rating: asRating(live.rating) ?? prev.rating,
    tagString: live.tagString,
    ts: now,
  }
}
