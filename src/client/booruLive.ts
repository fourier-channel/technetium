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

// ---------------------------------------------------------------------------
// Editing, from this side.
// ---------------------------------------------------------------------------

/**
 * The name the booru will actually store, from what a person typed.
 *
 * Danbooru downcases and turns whitespace into underscores, so "Blue Sky" and
 * "blue_sky" are ONE tag there. Doing it here rather than letting the server do
 * it silently is what makes the optimistic pill match the one that comes back:
 * otherwise "Blue Sky" pops in, the server answers "blue_sky", and the diff
 * reads that as one tag leaving and a different one arriving -- a visible
 * flicker on every edit that used a capital letter.
 *
 * Returns '' for anything that is not a tag once normalised; the caller must
 * treat that as "nothing was typed" rather than sending it.
 */
export function normaliseTagName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/^[_]+|[_]+$/g, '')
}

/** Split a typed line into tag names. People paste space-separated lists. */
export function parseTagInput(raw: string): string[] {
  const out: string[] = []
  for (const part of raw.split(/[\s,]+/)) {
    const name = normaliseTagName(part)
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

/**
 * The set as it will look if the edit succeeds, applied at once so the pill
 * moves under the finger rather than after a round trip.
 *
 * An ADDED tag is guessed 'general', because the category is the booru's to
 * decide and it has not been asked yet. The server's answer replaces this whole
 * set a moment later, so a tag that turns out to be a character recolours then.
 * Guessing is safe; leaving it out until the server replies is what would feel
 * slow.
 *
 * `tagString` is deliberately NOT updated. It records what this client last saw
 * the SERVER say, and it is what a subsequent edit sends as old_tag_string. If
 * an optimistic guess were written into it, a second edit made before the first
 * reply landed would claim the server had already agreed to the first one, and
 * the delta would be computed against something that never existed.
 */
export function optimisticSet(
  prev: MediaTagSet,
  edit: { add?: readonly string[]; remove?: readonly string[] },
  now: number,
): MediaTagSet {
  const removed = new Set(edit.remove ?? [])
  const tags = prev.tags.filter((t) => !removed.has(t.name))
  const have = new Set(tags.map((t) => t.name))
  for (const name of edit.add ?? []) {
    if (!have.has(name)) {
      tags.push({ name, category: 'general' })
      have.add(name)
    }
  }
  return { ...prev, tags, ts: now }
}
