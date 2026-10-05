// ---------------------------------------------------------------------------
// A pull tab rides the edge of the panel it pulls (operator, 2026-10-05:
// "when clicking the open/close buttons both on the top and right of the
// screen, the panel slides open but the BUTTON teleports to the new spot.
// very janky").
//
// It teleported because App drew each panel's tab TWICE -- a closed one on
// the border it pulls from and an open one at the panel's final edge -- and
// swapped them the instant the state flipped, while the panel was still
// sliding. Now each panel has ONE tab, mounted for good, inside a RAIL: a
// layer the size of the area the panel moves in, translated by the panel's
// own edge offset, on the same duration and the same easing as the panel's
// own transition. The tab moves by transform only (no top/right/left
// animation, no layout per frame), and the transition ends with the panel's,
// so at rest it costs nothing.
//
// WHICH SIDE OF THE EDGE IT SITS ON is the one discontinuity a design with
// two tab shapes has (launch-polish L15: a closed tab hangs OUTSIDE the
// border it pulls from; an open one sits INSIDE the panel at its edge). The
// switch is made where nobody can see it:
//   - opening: at the click. The panel's edge is still on the border, so the
//     inside-the-panel tab lies wholly beyond the clip and is hidden; it then
//     comes into view carried by the edge.
//   - closing: only when the panel has finished closing (its reveal has
//     unmounted). Until then it rides the edge back into the border and out
//     of sight; then the closed tab is drawn on the border.
// In between, the tab's attached side is exactly on the panel's edge.
//
// Pure, so the checks hold the geometry; tools/visual/tabride.sh measures the
// real thing frame by frame in Chromium.
// ---------------------------------------------------------------------------

import type { CSSProperties } from 'react'

/** Outside the border it pulls from (closed), or inside the panel at its edge. */
export type Attach = 'start' | 'end'

// `open`: the state the user asked for. `visible`: the panel is still on
// screen (its reveal is mounted), which is what keeps a closing tab on the
// edge until the edge has gone.
export function tabAttach(open: boolean, visible: boolean): Attach {
  return open || visible ? 'end' : 'start'
}

/** The rail's transform: the panel's edge offset along its axis. */
export function railTransform(axis: 'x' | 'y', offset: string): string {
  return axis === 'y' ? `translateY(${offset})` : `translateX(${offset})`
}

export function railStyle(axis: 'x' | 'y', offset: string, durationMs: number): CSSProperties {
  return { transform: railTransform(axis, offset), transitionDuration: `${durationMs}ms` }
}

/**
 * The dock's height as a share of <main>, as CSS. ONE expression for the dock
 * (DmDock.tsx) and the rail its tab rides, which is <main>-sized so that a
 * percentage translate means the same thing as the dock's percentage height.
 */
export function dockShareCss(shareOfMain: number): string {
  return `${Math.round(shareOfMain * 1000) / 10}%`
}

/**
 * Where the thread view's tab rides, from the row's right edge: the thread
 * tile's right edge is R0 (the member list and its divider, when the list is
 * open -- on a phone it is not, and the edge is the screen's), and opening
 * moves the tile's left edge W further left.
 */
export function threadTabGeometry(membersOpen: boolean, membersWidth: number, dividerPx: number, threadWidth: number, shown: boolean) {
  const r0 = membersOpen ? membersWidth + dividerPx : 0
  return { r0, offset: shown ? `${-threadWidth}px` : '0px' }
}
