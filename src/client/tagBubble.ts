import type { TagCategory } from './mediaTags'

// ---------------------------------------------------------------------------
// Which of an image's tags ride in the bubble under it, and which wait behind
// "expose tags" (launch-polish L5).
//
// Operator, 2026-09-24: "Perhaps reuse the existing chanbooru logic here
// (Modulation preset): ALWAYS show the creator tag and show character tag
// whenever it's present. The rest of the tags should be hidden with the
// 'expose tags' button."
//
// THE CREATOR TAG IS THE ARTIST-CATEGORY TAG. Every upload mints the poster's
// tag and promotes it to category artist, and Modulation's own "creator" axis
// is built from the artist names. It is NOT provenance 'creator': that bucket
// means prompt-derived tags, private by default and withheld by the booru, so
// keying on it would show nothing -- or the wrong thing.
//
// Modulation's collapsed shelf also shows copyright. The operator named
// creator and character only, so copyright folds with the rest; the operator's
// words win over the booru's layout where the two differ.
//
// Artist and character exist only after the live booru read (the Matrix copy
// is a flat list that parses as general), so before it lands everything is
// folded and the bubble shows the expose control alone.
//
// Pure, so the check suite holds it (O-tp9: types only from outside).
// ---------------------------------------------------------------------------

/** Shown in the bubble, in this order: who made it, then who is in it. */
export const BUBBLE_CATEGORIES: readonly TagCategory[] = ['artist', 'character']

export interface BubbleSplit<T> {
  always: T[]
  folded: T[]
}

/**
 * Split an already-sorted list. Input order is kept within each part, so
 * sortTags' alphabetical-within-category survives; `always` is regrouped so
 * every artist tag precedes every character tag whatever order they came in.
 * `categoryOf` lets the caller split raw tags or diffed entries alike.
 */
export function splitForBubble<T>(
  items: readonly T[],
  categoryOf: (x: T) => TagCategory,
): BubbleSplit<T> {
  const always: T[] = []
  for (const c of BUBBLE_CATEGORIES) for (const x of items) if (categoryOf(x) === c) always.push(x)
  const folded = items.filter((x) => !BUBBLE_CATEGORIES.includes(categoryOf(x)))
  return { always, folded }
}
