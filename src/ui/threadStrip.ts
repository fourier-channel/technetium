// How tall the thread strip needs to be, derived from what is in it.
//
// THE BUG THIS FIXES. The strip's height came from the layout alone -- a
// fraction of the viewport, 0.22 by default -- while its contents are a fixed
// 124px card under a small header. The track is `flex: 1`, so every pixel the
// layout gave beyond what the card needs became empty space ABOVE AND BELOW
// the card. On a 1080px screen 0.22 is 238px for about 150px of content: the
// operator's "too tall for the cards that occupy it".
//
// A FLOOR EXISTED AND A CEILING DID NOT. space.ts MIN_PX.threads.y stops the
// strip being shorter than its content. Nothing stopped it being taller,
// because nothing here knew how tall the content was. This module is that
// number, in one place, the way dmStrip.ts is the one place the DM faces'
// geometry lives.
//
// THE CARD HEIGHT IS ALSO IN index.css, and that is allowed rather than
// sloppy: a value used by both arithmetic and CSS may live in two files
// PROVIDED a check reads both and compares (D-tc01). checks/threadStrip
// does exactly that, so the two cannot drift in silence -- which matters
// here, because if they drifted the strip would crop its own cards.

/** .tc-carousel-card height in index.css. The check asserts they agree. */
export const THREAD_CARD_H = 124

/**
 * .tc-carousel-head: padding 5px top, 4px bottom, one line of 11px text.
 *
 * Measured from the rule rather than guessed, and deliberately a little
 * generous: too small here crops the header, which is worse than a pixel of
 * slack, and the whole point is to stop the slack being fifty.
 */
export const THREAD_HEAD_H = 5 + 16 + 4

/**
 * Air around the card so it is not welded to the header and the border.
 * The strip's own border-bottom is 1px; the rest is breathing room.
 */
export const THREAD_STRIP_PAD = 10

/** What the strip needs, and past which extra height is only empty space. */
export function threadStripHeight(): number {
  return THREAD_HEAD_H + THREAD_CARD_H + THREAD_STRIP_PAD
}

/**
 * The strip's height as CSS: the layout's share, but never taller than the
 * content needs.
 *
 * ONE STRING, USED TWICE. The tile's height and the pull-tab that rides the
 * tile's bottom edge both take this, because they are the same edge. They were
 * two expressions of one number before -- the tab read the raw percentage --
 * and capping only the tile would have left the tab floating in space below
 * it, which is the exact shape of bug dmStrip.ts was written to end.
 *
 * min() rather than a measured pixel height because both the percentage and
 * the cap resolve against the same containing block, so no JavaScript has to
 * know the viewport to keep them consistent.
 */
export function threadStripCss(shareOfColumn: number): string {
  const pct = Math.round(shareOfColumn * 1000) / 10
  return `min(${pct}%, ${threadStripHeight()}px)`
}
