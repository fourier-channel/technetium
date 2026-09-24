import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { placeUnfurl } from './popupPlacement'
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
// ATTACHED, NOT DROPPED: it follows its control however the control moves --
// a scroll, a resize, a carousel sliding its cards by transform -- and it
// closes only when the control is gone or clipped out of view. A popup
// floating over the header, attached to nothing on screen, would be a lie
// about what it belongs to.
//
// Positioned IMPERATIVELY, from a layout effect and animation-frame
// callbacks, never through React state: it moves every frame the control does
// and none of that should re-render the popup's contents (G-tc01 also forbids
// setting state synchronously in the effect that measures).
//
// PORTAL EVENTS STILL BUBBLE THROUGH THE REACT TREE. A click inside the popup
// would otherwise reach whatever the control lives in -- a thread card opens
// its thread on click, the lightbox's backdrop closes on click, the thread
// strip steps on arrow keys and on the wheel. The root stops them all.
// ---------------------------------------------------------------------------

// A press outside that lands on a CONTROL goes on to that control -- another
// image's "expose tags", a link. A press on anything else only closes the
// popup: one dismissal closes the innermost layer, so a click on the
// lightbox's backdrop that closed the popup must not also close the lightbox.
const CONTROL = 'button, a, input, select, textarea, [role="button"], [contenteditable]'

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

    // FOLLOWED EVERY FRAME, not on scroll events: the thread strip moves its
    // cards by transform and the re-sort by FLIP, neither of which fires any
    // event, and a popup left behind over the wrong card is the one outcome
    // "attached" rules out. One rect read per frame, and a write only when
    // something moved; it runs only while the popup is open.
    let last = ''
    const place = () => {
      if (!anchor.isConnected) return close()
      const a = anchor.getBoundingClientRect()
      const key = `${a.left},${a.top},${pop.offsetWidth},${pop.scrollHeight},${window.innerWidth},${window.innerHeight}`
      if (key !== last) {
        last = key
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
      raf = requestAnimationFrame(place)
    }
    place()
    // Into the popup, so a keyboard reader lands where the content is; the
    // portal puts it at the end of <body>, which Tab would never reach.
    pop.focus({ preventScroll: true })

    // Gone from view -- scrolled out, or slid past an edge that clips it --
    // means gone: an IntersectionObserver with no root clips by EVERY
    // overflow-clipping ancestor, which a nearest-scroller test missed for the
    // thread strip, where nothing scrolls and everything clips.
    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            if (entries.some((e) => !e.isIntersecting)) close()
          })
    io?.observe(anchor)

    let swallowClick: ((e: MouseEvent) => void) | null = null
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null
      if (t && (pop.contains(t) || anchor.contains(t))) return
      // A field inside is blurred FIRST, so its commit-on-blur runs while the
      // popup is still mounted; closing first unmounted it mid-commit and the
      // typed tags were dropped.
      const active = document.activeElement
      if (active instanceof HTMLElement && pop.contains(active)) active.blur()
      if (!(t instanceof Element && t.closest(CONTROL))) {
        swallowClick = (ev: MouseEvent) => {
          ev.stopPropagation()
          ev.preventDefault()
        }
        document.addEventListener('click', swallowClick, { capture: true, once: true })
        // A press that never becomes a click must not eat a later one.
        const armed = swallowClick
        window.setTimeout(() => document.removeEventListener('click', armed, { capture: true }), 1000)
      }
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
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      cancelAnimationFrame(raf)
      io?.disconnect()
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      // However it closed -- Escape, "collapse", "hide" -- a keyboard reader
      // goes back to the control that opened it, not to the top of the page.
      const active = document.activeElement
      if (anchor.isConnected && (active === document.body || active === null || pop.contains(active))) {
        anchor.focus({ preventScroll: true })
      }
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
      // Every event a popup's contents produce stays in the popup. React sends
      // a portal's events up the COMPONENT tree: a wheel over the popup
      // stepped the thread strip, a right-click on a tag opened the canvas
      // object's menu. Only propagation stops; the native link menu still
      // shows.
      onClick={stop}
      onDoubleClick={stop}
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerMove={stop}
      onMouseDown={stop}
      onMouseUp={stop}
      onWheel={stop}
      onContextMenu={stop}
      onFocus={stop}
      onBlur={stop}
      onKeyDown={stop}
    >
      {children}
    </div>,
    document.body,
  )
}
