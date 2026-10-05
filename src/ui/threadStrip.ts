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
 * The pull tabs, index.css .tc-pulltab; the check compares them (launch-polish
 * L15). A tab that pulls a collapsed panel OUT is 56 x 16; one that puts an
 * expanded panel BACK is the same length and 20 deep. The sideways tabs are
 * the same boxes turned 90 degrees.
 */
export const PULLTAB_W = 56
export const PULLTAB_CLOSED_H = 16
export const PULLTAB_OPEN_H = 20

/**
 * Air between the card and the strip's bottom edge. The "Hide threads" tab
 * (an EXPANDED tab, PULLTAB_OPEN_H) rides INSIDE that edge, so this is the
 * tab's lane plus clearance -- less than that and the tab sits on the focused
 * card, which is centred under it by construction.
 */
export const THREAD_TRACK_PAD_BOTTOM = PULLTAB_OPEN_H + 4

/**
 * On a phone the room list's and member list's tabs share the screen's side
 * edges (operator, 2026-09-29): "Room List has the upper position, user list
 * has the lower position, in both states." So the room list's tabs -- Rooms
 * on the left edge, its Back on the right -- ride above the middle, and the
 * member list's -- Members on the right, its Back on the left -- below it.
 * Each edge then carries one of each list, never two at one height. The two
 * spots are one tab length plus 16px apart, centre to centre.
 */
export const SIDE_TAB_SPREAD = PULLTAB_W + 16
export const ROOMS_TAB_TOP = `calc(50% - ${SIDE_TAB_SPREAD / 2}px)`
export const MEMBERS_TAB_TOP = `calc(50% + ${SIDE_TAB_SPREAD / 2}px)`

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
 * Where the DM dock's pull-down tab sits while the strip is on screen, in the
 * STRIP's coordinates. The dock's closed-state tab hangs from the region's top
 * border, and with the strip open that border is the strip's title bar, whose
 * label is centred. The free lane is RIGHT of the label: the scope pills fill
 * the left side from the edge and reach the centre on ordinary screens, the
 * sort pill sits at the far right. Its centre is the label's half-width + a
 * gap + the tab's own half-width right of centre -- but never so far right
 * that it reaches the sort pill, which on a narrow strip it would.
 * checks/threadStrip computes where everything lands at several widths.
 */
export const TITLE_HALF_W = 55 // "Thread Listing", 13px semibold: 110px, measured
export const PULLTAB_HALF_W = PULLTAB_W / 2
export const SORT_PILL_W = 80 // "Replies" pill with its caret, captions hidden
export const HEAD_PAD_X = 10
export const DM_TAB_GAP = 12
export const DM_TAB_BESIDE_TITLE =
  `min(calc(50% + ${TITLE_HALF_W + DM_TAB_GAP + PULLTAB_HALF_W}px), ` +
  `calc(100% - ${HEAD_PAD_X + SORT_PILL_W + DM_TAB_GAP + PULLTAB_HALF_W}px))`

/**
 * DM_TAB_BESIDE_TITLE in <main>'s coordinates rather than the strip's. The
 * dock's tab rides a rail the size of <main> (tabRide.ts), and the strip is
 * <main> less the domain tile on its right, so the strip's 50% and 100% are
 * <main>'s (100% - domain) / 2 and 100% - domain. With no domain it is the
 * constant itself.
 */
export function dmTabBesideTitle(domainPx: number): string {
  if (!(domainPx > 0)) return DM_TAB_BESIDE_TITLE
  return `min(calc((100% - ${domainPx}px) / 2 + ${TITLE_HALF_W + DM_TAB_GAP + PULLTAB_HALF_W}px), ` +
    `calc(100% - ${domainPx}px - ${HEAD_PAD_X + SORT_PILL_W + DM_TAB_GAP + PULLTAB_HALF_W}px))`
}

/**
 * The thread view's closed tab when the member list is not open (a phone, or
 * a screen that shed it): on the screen's right edge, where the Members tab
 * also is, so one slot below it -- a tab length and a gap further down.
 */
export const THREAD_TAB_TOP_EDGE = `calc(50% + ${SIDE_TAB_SPREAD * 1.5}px)`
