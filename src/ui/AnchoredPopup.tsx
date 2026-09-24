import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { anchorVisible, placeUnfurl } from './popupPlacement'
import { isTypingTarget } from './axisKeys'

// ---------------------------------------------------------------------------
// A popup attached to the control that opened it, drawn OVER the page rather
// than inside the panel that holds the control (launch-polish L5).
//
// Every scroller in this app clips: the timeline, the thread view, the thread
// strip, the thread cards. Anything positioned inside them is cut at their
// edge, which is how the tag list ended up "spilling all over the place" and
// how a thread card's tag list was clipped to a 52px cover. So the popup is
// portalled to <body> and placed in window coordinates by popupPlacement's
// pure rule, and it may cover the user list or anything else beside it.
//
// ATTACHED, NOT DROPPED: it follows its control while the page scrolls or
// resizes (the timeline re-pins itself whenever an image loads, so closing on
// every scroll would close it spuriously), and it closes only when the control
// is gone or scrolled out of its own scroller's view -- a popup floating over
// the header, attached to nothing on screen, would be a lie about what it
// belongs to.
//
// Positioned IMPERATIVELY, from a layout effect and animation-frame
// callbacks, never through React state: a scroll is dozens of events a second
// and none of them should re-render the popup's contents (G-tc01 also forbids
// setting state synchronously in the effect that measures).
//
// PORTAL EVENTS STILL BUBBLE THROUGH THE REACT TREE. A click inside the popup
// would otherwise reach whatever the control lives in -- a thread card opens
// its thread on click, the lightbox's backdrop closes on click, the thread
// strip steps on arrow keys. The root stops click, pointerdown and keydown.
// ---------------------------------------------------------------------------

/** The nearest ancestor that scrolls, whose visible box the anchor must be in. */
function scrollParentOf(el: HTMLElement): HTMLElement | null {
  let p = el.parentElement
  while (p && p !== document.body) {
    const s = getComputedStyle(p)
    if (/(auto|scroll)/.test(s.overflowY + s.overflowX)) return p
    p = p.parentElement
  }
  return null
}

export function AnchoredPopup({
  anchorRef,
  onClose,
  label,
  id,
  className,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
  /** What the popup is, for assistive technology. */
  label: string
  id?: string
  className?: string
  children: ReactNode
}) {
  const popRef = useRef<HTMLDivElement>(null)
  // The latest onClose, for listeners that outlive a render.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useLayoutEffect(() => {
    const pop = popRef.current
    const anchor = anchorRef.current
    if (!pop || !anchor) return
    const scroller = scrollParentOf(anchor)
    let raf = 0
    let closed = false
    const close = () => {
      if (closed) return
      closed = true
      onCloseRef.current()
    }

    // The popup's first control goes exactly where the control that opened it
    // was, so the popup reads as that control unfurling rather than as a
    // second window: shift by the popup's own padding and border, read from
    // its computed style rather than restated here.
    const cs = getComputedStyle(pop)
    const nudgeX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0)
    const nudgeY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.borderTopWidth) || 0)

    const place = () => {
      raf = 0
      if (!anchor.isConnected) return close()
      const a = anchor.getBoundingClientRect()
      if (scroller && !anchorVisible(a, scroller.getBoundingClientRect())) return close()
      const p = placeUnfurl(
        { left: a.left - nudgeX, top: a.top - nudgeY, right: a.right, bottom: a.bottom },
        { w: pop.offsetWidth, h: pop.scrollHeight },
        { w: window.innerWidth, h: window.innerHeight },
      )
      pop.style.left = `${p.x}px`
      pop.style.top = `${p.y}px`
      pop.style.maxHeight = `${p.maxH}px`
      pop.dataset.placed = 'true'
    }
    place()
    // Into the popup, so a keyboard reader lands where the content is; the
    // portal puts it at the end of <body>, which Tab would never reach.
    pop.focus({ preventScroll: true })

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(place)
    }
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    ro?.observe(pop)
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)

    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null
      if (t && (pop.contains(t) || anchor.contains(t))) return
      close()
    }
    // Capture phase, and stopped: the lightbox also closes on Escape, and one
    // Escape should close the innermost thing only. A key typed into the
    // popup's own field is the field's (it clears or leaves editing).
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (pop.contains(e.target as Node | null) && isTypingTarget(e.target)) return
      e.stopPropagation()
      e.preventDefault()
      close()
      anchor.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      if (raf) cancelAnimationFrame(raf)
      ro?.disconnect()
      window.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [anchorRef])

  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()
  return createPortal(
    <div
      ref={popRef}
      id={id}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className={'tc-anchored-pop' + (className ? ' ' + className : '')}
      onClick={stop}
      onPointerDown={stop}
      onKeyDown={stop}
    >
      {children}
    </div>,
    document.body,
  )
}
