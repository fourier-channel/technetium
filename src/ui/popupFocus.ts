import { useLayoutEffect, type RefObject } from 'react'
import { placeUnfurl, POPUP_MARGIN } from './popupPlacement'

// ---------------------------------------------------------------------------
// A menu or card opened AT a point, over everything (L23 review).
//
// Every person opens one of two of these -- the chat actions menu, or the
// profile preview -- from wherever that person is drawn. Three things each
// needs and neither had all of:
//
//   Placed on the page, not inside its panel. The menu was rendered inside
//   the timeline, and in the DM dock that sits under a transformed ancestor,
//   which makes `position: fixed` relative to the dock: the menu opened
//   displaced from the click and clipped at the dock's edge. Callers portal
//   to <body>; this places the box.
//   Clamped to the window. Opened from the member list at the right edge, or
//   a row near the bottom, the menu ran off screen with no way to reach the
//   cut-off items. placeUnfurl (popupPlacement.ts) is the one rule for that.
//   Focus goes in, and comes back. A keyboard user who pressed Enter on a
//   name opened something focus never reached. Focus moves to the first
//   live item (or the box) on open, and back to whatever opened it on close
//   -- only if focus is still inside, so a click elsewhere is not undone.
// ---------------------------------------------------------------------------

// Place `el` (position: fixed) at the point, inside the window, by its
// measured size; capped in height so a box taller than the window scrolls.
export function placeAt(el: HTMLElement, x: number, y: number, vp = { w: window.innerWidth, h: window.innerHeight }): void {
  const r = el.getBoundingClientRect()
  const p = placeUnfurl({ left: x, top: y, right: x, bottom: y }, { w: r.width, h: r.height }, vp, POPUP_MARGIN)
  el.style.left = `${p.x}px`
  el.style.top = `${p.y}px`
  el.style.maxHeight = `${p.maxH}px`
}

// Move focus into `el` -- its first live item, else the box itself -- and
// return what puts it back where it came from, if it is still inside.
export function takeFocus(el: HTMLElement): () => void {
  const doc = el.ownerDocument
  const was = doc.activeElement
  const opener = was && was !== doc.body && 'focus' in was ? (was as HTMLElement) : null
  const first = el.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled), button:not(:disabled)')
  ;(first ?? el).focus({ preventScroll: true })
  return () => {
    const active = doc.activeElement
    const focusWasInside = !active || active === doc.body || el.contains(active)
    if (focusWasInside && opener?.isConnected) opener.focus({ preventScroll: true })
  }
}

export function usePopupAt(ref: RefObject<HTMLElement | null>, x: number, y: number): void {
  useLayoutEffect(() => {
    if (ref.current) placeAt(ref.current, x, y)
  }, [ref, x, y])
}

export function usePopupFocus(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => (ref.current ? takeFocus(ref.current) : undefined), [ref])
}

// Arrow keys between a menu's items: the index of the item to focus next, or
// null when the key is not a menu key. Wraps, as menus do.
export function menuStep(key: string, index: number, count: number): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowDown': return (index + 1 + count) % count
    // From the box itself (index -1), up is the last item, not the one before it.
    case 'ArrowUp': return index < 0 ? count - 1 : (index - 1 + count) % count
    case 'Home': return 0
    case 'End': return count - 1
    default: return null
  }
}
