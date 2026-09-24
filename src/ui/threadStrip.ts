// How tall the thread strip needs to be, derived from what is in it.
//
// THE BUG THIS FIXES. The strip's height came from the layout alone -- a
// fraction of the viewport, 0.22 by default -- while its contents are a fixed
// 124px card under a small header. The track is `flex: 1`, so every pixel the
// layout gave beyond what the card needs became empty space ABOVE AND BELOW
// the card. On a 1080px screen 0.22 is 238px for about 150px of content: the
// operator's "too tall for the cards that occupy it".
//
// A CEILING WAS NOT ENOUGH. The first fix capped the share at the content's
// height with min(), and got the content's height wrong: the header was
// budgeted at 25px and rendered at 36, and the card's 1px border was left out
// of its 124. So the cap cropped the card, clipped its shadow, and put the
// Hide-threads tab on top of it. The strip is now exactly the sum of parts
// that the CSS DECLARES, and nothing else.
//
// EVERY PART IS ALSO IN index.css -- the card height, the header height, the
// track's padding, the tab's height -- and that is allowed rather than sloppy:
// a value used by both arithmetic and CSS may live in two files PROVIDED a
// check reads both and compares (D-tc01). checks/threadStrip does, so they
// cannot drift in silence, which matters here because a drift crops the card.

/**
 * .tc-carousel-card height in index.css, OUTER: the card is border-box, so
 * this is the whole box, border included. The check asserts they agree.
 */
export const THREAD_CARD_H = 124

/**
 * .tc-carousel-head height in index.css, border included (border-box).
 *
 * DECLARED, not estimated. The first version of this module budgeted 25px for
 * "one line of 11px text" while the header actually rendered at 36px: the
 * root's `font: 18px/145%` is inherited as a computed 26px line box by every
 * element that does not set its own, so the header's real height was the
 * font's business rather than anybody's decision. The CSS now states a
 * height and a line-height, and the check compares the two numbers.
 */
export const THREAD_HEAD_H = 32

/** Air between the header and the card. */
export const THREAD_TRACK_PAD_TOP = 8

/**
 * Air between the card and the strip's bottom edge. The "Hide threads" tab
 * (12px) rides INSIDE that edge, so this is the tab's lane plus clearance --
 * less than that and the tab sits on the focused card, which is centred
 * under it by construction.
 */
export const THREAD_TRACK_PAD_BOTTOM = 16

/** The tab's height, index.css .tc-pulltab; the check compares them. */
export const PULLTAB_H = 12

/** What the strip is: its header, one card, and the air around it. */
export function threadStripHeight(): number {
  return THREAD_HEAD_H + THREAD_TRACK_PAD_TOP + THREAD_CARD_H + THREAD_TRACK_PAD_BOTTOM
}

/**
 * The strip's height as CSS.
 *
 * A fixed number, and no longer a share of the layout. The share only ever
 * produced one of two faults: taller than the card, and the surplus became
 * dead space above and below it (operator, 2026-09-24: "Look at all that dead
 * space above and below the thread cards"); shorter, and it cropped the card.
 * Nothing in the interface resizes the strip, so there was never a size the
 * user chose for it to honour.
 *
 * ONE STRING, USED TWICE. The tile's height and the pull-tab that rides the
 * tile's bottom edge both take this, because they are the same edge.
 */
export function threadStripCss(): string {
  return `${threadStripHeight()}px`
}

/**
 * Where the DM dock's pull-down tab sits while the strip is open. The dock's
 * closed-state tab hangs from the region's top border, and with the strip
 * open that border is the strip's title bar, whose label is centred. At its
 * usual 50% - 40px the 46px tab covers the label's left half; here its centre
 * is the label's half-width (about 48px), a 12px gap and its own half-width
 * (23px) left of centre, rounded out.
 */
export const DM_TAB_BESIDE_TITLE = 'calc(50% - 90px)'
