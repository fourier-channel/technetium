import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

// ---------------------------------------------------------------------------
// FLIP (First, Last, Invert, Play) -- the ONE shared reorder-animation system
// for the thread list. Consumed by sort-mode switches (step 1), auto-resort
// shuffles (step 3), and drag-drop settle (steps 4-6). CSS transforms only:
// measure old rects, let the DOM reorder, invert each moved node with a
// translate, then transition the translate back to identity. No layout thrash
// (reads and writes are batched with a single forced reflow between).
//
// Positions are captured in the container's CONTENT coordinate space
// (viewport rect minus container rect plus scroll offset) so that a list scroll
// between capture and play does NOT masquerade as movement -- only genuine
// order changes produce a non-zero delta.
//
// prefers-reduced-motion: the transform shuffle is skipped (instant reorder);
// the crossfade replacement is polish deferred to step 7.
// ---------------------------------------------------------------------------

// Stable per-card identity for FLIP + custom-order persistence. Always the
// (roomId, rootId) pair (D5 key discipline), joined with a separator so ids
// can't collide across rooms.
export function flipIdOf(roomId: string, rootId: string): string {
  return roomId + '|' + rootId
}

export type FlipPos = { top: number; left: number }
export type FlipRects = Map<string, FlipPos>

export interface PlayFlipOptions {
  durationMs?: number
  easing?: string
}

const DEFAULT_DURATION = 200
// ease-out; matches D2's "~200ms, ease-out".
const DEFAULT_EASING = 'cubic-bezier(0.2, 0, 0, 1)'

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function contentPos(el: HTMLElement, container: HTMLElement): FlipPos {
  const r = el.getBoundingClientRect()
  const c = container.getBoundingClientRect()
  return {
    top: r.top - c.top + container.scrollTop,
    left: r.left - c.left + container.scrollLeft,
  }
}

// Snapshot the content-space positions of every [data-flip-id] descendant.
export function captureRects(container: HTMLElement | null): FlipRects {
  const rects: FlipRects = new Map()
  if (!container) return rects
  const nodes = container.querySelectorAll<HTMLElement>('[data-flip-id]')
  nodes.forEach((el) => {
    const id = el.dataset.flipId
    if (id) rects.set(id, contentPos(el, container))
  })
  return rects
}

// Invert-and-play from a prior snapshot to the current (already-reordered) DOM.
// Nodes with no prior rect (freshly inserted) are left alone -- enter animation
// is a separate concern. Nodes that did not move are skipped, which also avoids
// the no-op-transition trap (G-04f01d: transitionend never fires when nothing
// actually changes).
export function playFLIP(
  container: HTMLElement | null,
  prev: FlipRects,
  opts: PlayFlipOptions = {},
): void {
  if (!container || prev.size === 0) return

  const duration = opts.durationMs ?? DEFAULT_DURATION
  const easing = opts.easing ?? DEFAULT_EASING
  const nodes = Array.from(container.querySelectorAll<HTMLElement>('[data-flip-id]'))

  // READ pass: compute deltas against the prior snapshot (no writes yet).
  const moved: { el: HTMLElement; dx: number; dy: number }[] = []
  for (const el of nodes) {
    const id = el.dataset.flipId
    if (!id) continue
    const before = prev.get(id)
    if (!before) continue // new node -- no invert
    const now = contentPos(el, container)
    const dx = before.left - now.left
    const dy = before.top - now.top
    if (dx === 0 && dy === 0) continue
    moved.push({ el, dx, dy })
  }
  if (moved.length === 0) return
  // Reduced motion: no positional sliding. Moved cards appear in their new slots
  // with a brief opacity crossfade instead (feel spec).
  if (prefersReducedMotion()) {
    for (const { el } of moved) {
      el.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' })
    }
    return
  }

  // WRITE pass 1 (First+Invert): translate every moved node back to where it
  // was, with transitions disabled so the jump is instant/invisible.
  for (const { el, dx, dy } of moved) {
    el.style.transition = 'none'
    el.style.transform = `translate(${dx}px, ${dy}px)`
  }
  // Single forced reflow to commit the inverted start positions.
  void container.offsetWidth

  // WRITE pass 2 (Play): next frame, transition the translate back to identity.
  requestAnimationFrame(() => {
    for (const { el } of moved) {
      el.style.transition = `transform ${duration}ms ${easing}`
      el.style.transform = ''
      const clear = () => {
        el.style.transition = ''
        el.style.transform = ''
        el.removeEventListener('transitionend', clear)
      }
      el.addEventListener('transitionend', clear)
      // Failsafe: transitionend is not guaranteed to fire (interrupted, or a
      // sub-pixel no-op). Clean up unconditionally just after the duration.
      window.setTimeout(clear, duration + 80)
    }
  })
}

// Imperative handle for consumers that own the visuals of a specific reorder
// (the drag layer): while `setDragging(true)` is in effect the FLIP layer keeps
// hands off (no animation, no rebaseline), and `recapture()` re-snapshots the
// settled positions as the new baseline once the drag's own settle finishes.
export interface FlipControl {
  setDragging: (dragging: boolean) => void
  recapture: () => void
}

// React glue: run a FLIP whenever `orderKey` changes. Captures the settled
// positions after each order change so the NEXT change inverts from them. The
// first run only snapshots (nothing to animate from). Stat-only re-renders that
// leave `orderKey` unchanged do not trigger a capture, so positions stay valid.
export function useFlipList(
  containerRef: RefObject<HTMLElement | null>,
  orderKey: string,
  controlRef?: RefObject<FlipControl | null>,
  opts?: PlayFlipOptions,
): void {
  const prevRef = useRef<FlipRects>(new Map())
  const primedRef = useRef(false)
  const draggingRef = useRef(false)

  useEffect(() => {
    if (!controlRef) return
    controlRef.current = {
      setDragging: (d: boolean) => {
        draggingRef.current = d
      },
      recapture: () => {
        const c = containerRef.current
        if (c) prevRef.current = captureRects(c)
      },
    }
    return () => {
      if (controlRef) controlRef.current = null
    }
  }, [controlRef, containerRef])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    if (!primedRef.current) {
      primedRef.current = true
      prevRef.current = captureRects(container)
      return
    }
    // During a drag the drag layer owns every transform; skipping both the
    // animation and the rebaseline avoids capturing transformed (mid-drag)
    // positions. The drag calls recapture() after its settle completes.
    if (draggingRef.current) return
    playFLIP(container, prevRef.current, opts)
    prevRef.current = captureRects(container)
    // opts is a plain literal from the caller; intentionally not a dep -- order
    // changes drive the animation, not option identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey])
}
