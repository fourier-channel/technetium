import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { prefersReducedMotion, type FlipControl } from './flip'

// ---------------------------------------------------------------------------
// Hand-rolled pointer-capture drag-to-reorder for the thread list (D4 -- no
// dnd-kit). 1-D vertical. Mouse/pen only for v1: touch keeps scrolling the list
// (distinguishing scroll from drag needs touch-action, which would break the
// list's own scroll), so touch reorder is deferred.
//
// Mechanics:
//  - pointerdown captures the pointer but does NOT engage -- a plain click still
//    opens the thread.
//  - past a 5px movement threshold the drag engages ("lift"): the card scales,
//    tilts, deepens its shadow, and follows the pointer with a lerp lag so it
//    has weight.
//  - siblings displace live by the dragged card's height to open the drop gap,
//    projected from the dragged card's center vs sibling centers (static layout
//    measured once at engage, so index calc doesn't chase the moving cards).
//  - on drop the new order is committed (switching the list to custom mode) and
//    the dragged card settles from finger to slot via WAAPI; the FLIP layer is
//    held off for the whole gesture and rebaselined after the settle.
//
// The FLIP layer is suppressed during the gesture via FlipControl so imperative
// transforms here are the single source of visual truth.
// ---------------------------------------------------------------------------

const THRESHOLD_PX = 5
const LERP = 0.25
const LIFT_SCALE = 1.03
const TILT_DEG = 1
const SETTLE_MS = 240
const CANCEL_MS = 220
const SIBLING_MS = 180
const LIFT_SHADOW = '0 8px 20px rgba(0,0,0,0.45)'
const CLICK_SUPPRESS_MS = 400
// Autoscroll when the pointer nears a list edge during a drag.
const EDGE_PX = 44
const MAX_SCROLL_SPEED = 14
// Horizontal slack past the list edge before a release counts as "drop outside"
// (spring back, no reorder).
const OUTSIDE_SLACK_PX = 60

interface CardGeom {
  id: string
  el: HTMLElement
  top: number
  height: number
  center: number
}

interface DragSession {
  pointerId: number
  id: string
  cardEl: HTMLElement
  pointerStartY: number
  pointerY: number
  engaged: boolean
  // set once engaged:
  cards: CardGeom[]
  dragIndex: number
  draggedHeight: number
  followY: number
  startScrollTop: number
  reduced: boolean
  raf: number
}

interface PendingSettle {
  id: string
  followY: number
  origTop: number
  reduced: boolean
}

export interface ThreadDragOptions {
  containerRef: RefObject<HTMLElement | null>
  // Current on-screen order of card ids (frozen during the gesture).
  orderedIds: string[]
  // Commit a new order; the caller switches the list into custom mode (O1).
  onReorder: (finalIds: string[]) => void
  flipControlRef: RefObject<FlipControl | null>
}

// Measure the [data-flip-id] cards in container-content coordinates.
function measureCards(container: HTMLElement): CardGeom[] {
  const c = container.getBoundingClientRect()
  const out: CardGeom[] = []
  const nodes = container.querySelectorAll<HTMLElement>('[data-flip-id]')
  nodes.forEach((el) => {
    const id = el.dataset.flipId
    if (!id) return
    const r = el.getBoundingClientRect()
    const top = r.top - c.top + container.scrollTop
    out.push({ id, el, top, height: r.height, center: top + r.height / 2 })
  })
  return out
}

function clearCardStyles(el: HTMLElement): void {
  el.style.transition = ''
  el.style.transform = ''
  el.style.zIndex = ''
  el.style.boxShadow = ''
  el.style.cursor = ''
  el.style.willChange = ''
}

export function useThreadDrag(opts: ThreadDragOptions): {
  getCardHandlers: (id: string) => {
    onPointerDown: (e: ReactPointerEvent) => void
    onPointerMove: (e: ReactPointerEvent) => void
    onPointerUp: (e: ReactPointerEvent) => void
    onPointerCancel: (e: ReactPointerEvent) => void
  }
  consumeClickSuppressed: (id: string) => boolean
} {
  const { containerRef, flipControlRef } = opts

  // Mirror the latest props into refs so event handlers (fired long after
  // render) read current values without being recreated.
  const orderedRef = useRef(opts.orderedIds)
  const onReorderRef = useRef(opts.onReorder)
  useEffect(() => {
    orderedRef.current = opts.orderedIds
    onReorderRef.current = opts.onReorder
  })

  const sessionRef = useRef<DragSession | null>(null)
  const pendingSettleRef = useRef<PendingSettle | null>(null)
  const suppressedClicksRef = useRef<Set<string>>(new Set())
  const [commitN, setCommitN] = useState(0)

  const endGesture = useCallback(() => {
    const s = sessionRef.current
    if (s) {
      cancelAnimationFrame(s.raf)
      try {
        if (s.cardEl.hasPointerCapture(s.pointerId)) s.cardEl.releasePointerCapture(s.pointerId)
      } catch {
        // pointer already released
      }
    }
    document.body.style.userSelect = ''
    sessionRef.current = null
  }, [])

  const applySiblingShifts = useCallback((s: DragSession, draggedCenter: number) => {
    for (let j = 0; j < s.cards.length; j++) {
      if (j === s.dragIndex) continue
      const card = s.cards[j]
      const shouldBeBelow = card.center > draggedCenter
      const wasBelow = j > s.dragIndex
      let shift = 0
      if (wasBelow && !shouldBeBelow) shift = -s.draggedHeight
      else if (!wasBelow && shouldBeBelow) shift = s.draggedHeight
      card.el.style.transform = shift === 0 ? '' : `translateY(${shift}px)`
    }
  }, [])

  const tick = useCallback(
    function tickLoop() {
      const s = sessionRef.current
      if (!s || !s.engaged) return
      const container = containerRef.current

      // Autoscroll when the pointer is near a list edge.
      if (container) {
        const rect = container.getBoundingClientRect()
        let d = 0
        if (s.pointerY < rect.top + EDGE_PX) {
          d = -MAX_SCROLL_SPEED * Math.min(1, (rect.top + EDGE_PX - s.pointerY) / EDGE_PX)
        } else if (s.pointerY > rect.bottom - EDGE_PX) {
          d = MAX_SCROLL_SPEED * Math.min(1, (s.pointerY - (rect.bottom - EDGE_PX)) / EDGE_PX)
        }
        if (d !== 0) {
          const maxScroll = container.scrollHeight - container.clientHeight
          container.scrollTop = Math.max(0, Math.min(maxScroll, container.scrollTop + d))
        }
      }

      // Follow target folds in the scroll delta so the projected index stays
      // consistent in content space as the list autoscrolls (content coords are
      // scroll-independent; the visual translate is dPointer + dScroll).
      const scrollDelta = container ? container.scrollTop - s.startScrollTop : 0
      const targetY = s.pointerY - s.pointerStartY + scrollDelta
      // Reduced motion: no weight lag (follow directly) and no tilt.
      s.followY += (targetY - s.followY) * (s.reduced ? 1 : LERP)
      const tilt = s.reduced ? 0 : TILT_DEG
      s.cardEl.style.transform = `translateY(${s.followY}px) scale(${LIFT_SCALE}) rotate(${tilt}deg)`
      const draggedCenter = s.cards[s.dragIndex].center + s.followY
      applySiblingShifts(s, draggedCenter)
      // Self-reference by the function-expression name (not the outer const) so
      // the loop reschedules without a use-before-declaration.
      s.raf = requestAnimationFrame(tickLoop)
    },
    [applySiblingShifts, containerRef],
  )

  const engage = useCallback(
    (s: DragSession) => {
      const container = containerRef.current
      if (!container) return
      const cards = measureCards(container)
      const dragIndex = cards.findIndex((c) => c.id === s.id)
      if (dragIndex < 0) return
      s.cards = cards
      s.dragIndex = dragIndex
      s.draggedHeight = cards[dragIndex].height
      s.followY = 0
      s.startScrollTop = container.scrollTop
      s.reduced = prefersReducedMotion()
      s.engaged = true

      // Capture the pointer now that a real drag has started, so subsequent
      // moves/up route here even if the pointer leaves the card. (Deliberately
      // not done on pointerdown -- see onPointerDown.)
      try {
        s.cardEl.setPointerCapture(s.pointerId)
      } catch {
        // capture unavailable; drag still works while the pointer stays over the list
      }

      // Freeze FLIP for the gesture; the drag owns transforms now.
      flipControlRef.current?.setDragging(true)
      document.body.style.userSelect = 'none'

      // Siblings get a transition so their displacement is smooth; the dragged
      // card is updated every frame with no transition.
      for (let j = 0; j < cards.length; j++) {
        if (j === dragIndex) continue
        cards[j].el.style.transition = `transform ${SIBLING_MS}ms ease`
      }
      s.cardEl.style.transition = 'none'
      s.cardEl.style.zIndex = '10'
      s.cardEl.style.boxShadow = LIFT_SHADOW
      s.cardEl.style.cursor = 'grabbing'
      s.cardEl.style.willChange = 'transform'

      s.raf = requestAnimationFrame(tick)
    },
    [containerRef, flipControlRef, tick],
  )

  const drop = useCallback(
    (s: DragSession) => {
      cancelAnimationFrame(s.raf)
      const draggedCenter = s.cards[s.dragIndex].center + s.followY

      const above: string[] = []
      const below: string[] = []
      for (let j = 0; j < s.cards.length; j++) {
        if (j === s.dragIndex) continue
        if (s.cards[j].center > draggedCenter) below.push(s.cards[j].id)
        else above.push(s.cards[j].id)
      }
      const finalIds = [...above, s.id, ...below]

      // Suppress the click that follows this pointerup (an engaged drag must not
      // also open the thread).
      suppressedClicksRef.current.add(s.id)
      const suppressedId = s.id
      window.setTimeout(() => suppressedClicksRef.current.delete(suppressedId), CLICK_SUPPRESS_MS)

      pendingSettleRef.current = {
        id: s.id,
        followY: s.followY,
        origTop: s.cards[s.dragIndex].top,
        reduced: s.reduced,
      }

      document.body.style.userSelect = ''
      try {
        if (s.cardEl.hasPointerCapture(s.pointerId)) s.cardEl.releasePointerCapture(s.pointerId)
      } catch {
        // already released
      }
      sessionRef.current = null

      // Commit order (switches list to custom mode). FLIP stays suppressed
      // (setDragging still true); the settle layout-effect below animates the
      // dragged card and then rebaselines FLIP.
      onReorderRef.current(finalIds)
      setCommitN((n) => n + 1)
    },
    [],
  )

  // Cancel: spring the card back to its origin with NO reorder (Escape, or a
  // release well outside the list).
  const cancelDrag = useCallback(
    (s: DragSession) => {
      cancelAnimationFrame(s.raf)
      suppressedClicksRef.current.add(s.id)
      const sid = s.id
      window.setTimeout(() => suppressedClicksRef.current.delete(sid), CLICK_SUPPRESS_MS)

      const el = s.cardEl
      const fromY = s.followY
      for (const c of s.cards) if (c.el !== el) c.el.style.transform = ''

      let done = false
      const finish = () => {
        if (done) return
        done = true
        for (const c of s.cards) clearCardStyles(c.el)
        clearCardStyles(el)
        flipControlRef.current?.setDragging(false)
        flipControlRef.current?.recapture()
      }

      if (s.reduced) {
        // No spring-back animation under reduced motion; snap to origin.
        el.style.transform = ''
        finish()
      } else {
        el.style.transition = 'none'
        el.style.transform = ''
        const anim = el.animate(
          [
            { transform: `translateY(${fromY}px) scale(${LIFT_SCALE}) rotate(${TILT_DEG}deg)`, boxShadow: LIFT_SHADOW },
            { transform: 'translateY(0) scale(1) rotate(0deg)', boxShadow: '0 0 0 0 rgba(0,0,0,0)' },
          ],
          { duration: CANCEL_MS, easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)' },
        )
        anim.onfinish = finish
        anim.oncancel = finish
        window.setTimeout(finish, CANCEL_MS + 80)
      }

      document.body.style.userSelect = ''
      try {
        if (el.hasPointerCapture(s.pointerId)) el.releasePointerCapture(s.pointerId)
      } catch {
        // already released
      }
      sessionRef.current = null
    },
    [flipControlRef],
  )

  // Post-commit settle: runs after onReorder re-rendered the list into the new
  // order. Clears all imperative transforms, then animates the dragged card from
  // where the finger left it to its committed slot.
  useLayoutEffect(() => {
    const p = pendingSettleRef.current
    if (!p) return
    pendingSettleRef.current = null
    const container = containerRef.current
    if (!container) {
      flipControlRef.current?.setDragging(false)
      return
    }

    // Clear every imperative transform FIRST, then measure -- getBoundingClientRect
    // reflects transforms, so measuring before clearing would read the dragged
    // card's finger position instead of its true resting slot.
    container.querySelectorAll<HTMLElement>('[data-flip-id]').forEach(clearCardStyles)
    const cards = measureCards(container)

    const dragged = cards.find((c) => c.id === p.id)
    const finish = () => {
      flipControlRef.current?.setDragging(false)
      flipControlRef.current?.recapture()
    }
    // Reduced motion: the card is already at its slot (transforms cleared) --
    // no settle animation.
    if (!dragged || p.reduced) {
      finish()
      return
    }
    // Where the finger released the card, relative to its new resting slot.
    const startY = p.origTop + p.followY - dragged.top
    // Overshoot settle (feel spec): slide to the slot, land at scale 1, then a
    // subtle scale bounce to ~1.015 and back to 1.0 as the shadow relaxes.
    const anim = dragged.el.animate(
      [
        {
          transform: `translateY(${startY}px) scale(${LIFT_SCALE}) rotate(${TILT_DEG}deg)`,
          boxShadow: LIFT_SHADOW,
          offset: 0,
        },
        { transform: 'translateY(0) scale(1) rotate(0deg)', boxShadow: '0 3px 10px rgba(0,0,0,0.28)', offset: 0.6 },
        { transform: 'translateY(0) scale(1.015) rotate(0deg)', boxShadow: '0 1px 5px rgba(0,0,0,0.18)', offset: 0.8 },
        { transform: 'translateY(0) scale(1) rotate(0deg)', boxShadow: '0 0 0 0 rgba(0,0,0,0)', offset: 1 },
      ],
      { duration: SETTLE_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    )
    let done = false
    const once = () => {
      if (done) return
      done = true
      finish()
    }
    anim.onfinish = once
    anim.oncancel = once
    // Failsafe (G-04f01d: transition/animation end not guaranteed).
    window.setTimeout(once, SETTLE_MS + 80)
  }, [commitN, containerRef, flipControlRef])

  const onPointerDown = useCallback((id: string, e: ReactPointerEvent) => {
    if (e.pointerType === 'touch') return // touch scrolls the list; reorder deferred
    if (e.button !== 0) return
    if (sessionRef.current) return
    const cardEl = e.currentTarget as HTMLElement
    // NOTE: do NOT setPointerCapture here. Capturing on pointerdown suppresses the
    // subsequent `click` in Chromium, which made tiles un-openable. Capture only
    // when the drag actually engages (past the threshold), so a plain click never
    // captures and its click event fires normally.
    sessionRef.current = {
      pointerId: e.pointerId,
      id,
      cardEl,
      pointerStartY: e.clientY,
      pointerY: e.clientY,
      engaged: false,
      cards: [],
      dragIndex: -1,
      draggedHeight: 0,
      followY: 0,
      startScrollTop: 0,
      reduced: false,
      raf: 0,
    }
  }, [])

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const s = sessionRef.current
      if (!s || e.pointerId !== s.pointerId) return
      s.pointerY = e.clientY
      if (!s.engaged) {
        if (Math.abs(e.clientY - s.pointerStartY) < THRESHOLD_PX) return
        engage(s)
      }
      e.preventDefault()
    },
    [engage],
  )

  const onPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      const s = sessionRef.current
      if (!s || e.pointerId !== s.pointerId) return
      if (s.engaged) {
        // Release well outside the list -> cancel (spring back, no reorder).
        const container = containerRef.current
        let outside = false
        if (container) {
          const r = container.getBoundingClientRect()
          outside = e.clientX < r.left - OUTSIDE_SLACK_PX || e.clientX > r.right + OUTSIDE_SLACK_PX
        }
        if (outside) cancelDrag(s)
        else drop(s)
      } else {
        // A plain click: release capture, let the click open the thread.
        endGesture()
      }
    },
    [drop, cancelDrag, endGesture, containerRef],
  )

  const onPointerCancel = useCallback(
    (e: ReactPointerEvent) => {
      const s = sessionRef.current
      if (!s || e.pointerId !== s.pointerId) return
      if (s.engaged) {
        // Snap everything back; treat as no reorder.
        const container = containerRef.current
        if (container) for (const c of measureCards(container)) clearCardStyles(c.el)
        flipControlRef.current?.setDragging(false)
        flipControlRef.current?.recapture()
      }
      endGesture()
    },
    [containerRef, flipControlRef, endGesture],
  )

  const getCardHandlers = useCallback(
    (id: string) => ({
      onPointerDown: (e: ReactPointerEvent) => onPointerDown(id, e),
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    }),
    [onPointerDown, onPointerMove, onPointerUp, onPointerCancel],
  )

  const consumeClickSuppressed = useCallback((id: string): boolean => {
    if (suppressedClicksRef.current.has(id)) {
      suppressedClicksRef.current.delete(id)
      return true
    }
    return false
  }, [])

  // Escape cancels an engaged drag.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const s = sessionRef.current
      if (s?.engaged) {
        e.preventDefault()
        cancelDrag(s)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancelDrag])

  useEffect(() => endGesture, [endGesture])

  return { getCardHandlers, consumeClickSuppressed }
}
