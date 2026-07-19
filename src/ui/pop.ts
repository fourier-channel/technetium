import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { prefersReducedMotion } from './flip'

// ---------------------------------------------------------------------------
// Per-card "pop" -- a brief pulse when a thread updates (D1). Rate-limited to
// at most one pop per card per POP_MIN_INTERVAL_MS so a burst of replies pulses
// once, not a strobe. Uses the Web Animations API (self-cleaning, `fill: none`
// reverts to the element's own styles) applied to an INNER element so it never
// competes with the FLIP translate on the outer [data-flip-id] card.
//
// prefers-reduced-motion: the scale pulse becomes a short accent-color blink
// (feel spec).
// ---------------------------------------------------------------------------

const POP_MIN_INTERVAL_MS = 2000

// Fire when `signal` rises above its previous value. `signal` should be a
// monotonic activity marker for the card (last-activity timestamp): it advances
// on any new post/reply and never on an unrelated re-render, so no pop on mount
// and no spurious pops from stat re-reads.
export function usePopOnIncrease(ref: RefObject<HTMLElement | null>, signal: number): void {
  const prevSignal = useRef(signal)
  const lastPop = useRef(0)

  useEffect(() => {
    const increased = signal > prevSignal.current
    prevSignal.current = signal
    if (!increased) return
    const el = ref.current
    if (!el) return

    const now = Date.now()
    if (now - lastPop.current < POP_MIN_INTERVAL_MS) return
    lastPop.current = now

    if (prefersReducedMotion()) {
      el.animate(
        [
          { backgroundColor: 'var(--cpd-color-bg-action-primary-rest)' },
          { backgroundColor: 'transparent' },
        ],
        { duration: 500, easing: 'ease-out' },
      )
      return
    }

    el.animate(
      [
        { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(0,0,0,0)' },
        {
          transform: 'scale(1.06)',
          boxShadow: '0 0 12px 2px var(--cpd-color-bg-action-primary-rest)',
          offset: 0.5,
        },
        { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(0,0,0,0)' },
      ],
      { duration: 300, easing: 'ease-out' },
    )
  }, [signal, ref])
}

// ---------------------------------------------------------------------------
// Enter "pop" for newly-present rows. Complements useFlipList (which slides the
// rows that MOVED down to open a gap): this animates the rows that just
// APPEARED -- a scale + fade + brief accent glow, staggered and LAGGED slightly
// so the push leads and the newcomer drops into the opened space.
//
// Web Animations API, self-cleaning. `fill: 'backwards'` applies the hidden
// start keyframe during the lag delay (so a newcomer stays invisible until its
// turn -- no pre-pop flash) and reverts afterward, leaving NO persistent
// transform to fight a later FLIP translate on the same row. First mount only
// records the baseline; rows already present never pop. Reduced motion: a colour
// blink, no scale/translate (feel spec).
// ---------------------------------------------------------------------------

const ENTER_LEAD_MS = 90 // let the push open the gap before the newcomer pops
const ENTER_STEP_MS = 14 // stagger between successive newcomers
const ENTER_MAX_STAGGER_MS = 260 // cap so a big batch does not cascade forever

export function usePopEnter(containerRef: RefObject<HTMLElement | null>, orderKey: string): void {
  const seen = useRef<Set<string>>(new Set())
  const primed = useRef(false)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const nodes = Array.from(container.querySelectorAll<HTMLElement>('[data-flip-id]'))
    const ids = new Set<string>()
    const fresh: HTMLElement[] = []
    for (const el of nodes) {
      const id = el.dataset.flipId
      if (!id) continue
      ids.add(id)
      if (primed.current && !seen.current.has(id)) fresh.push(el)
    }
    seen.current = ids

    // First populated render is the baseline -- nothing "entered" yet.
    if (!primed.current) {
      primed.current = true
      return
    }
    if (fresh.length === 0) return

    const reduced = prefersReducedMotion()
    let n = 0
    for (const el of fresh) {
      const delay = Math.min(ENTER_LEAD_MS + n++ * ENTER_STEP_MS, ENTER_LEAD_MS + ENTER_MAX_STAGGER_MS)
      if (reduced) {
        el.animate(
          [
            { backgroundColor: 'var(--cpd-color-bg-action-primary-rest)' },
            { backgroundColor: 'transparent' },
          ],
          { duration: 500, delay, easing: 'ease-out' },
        )
        continue
      }
      el.animate(
        [
          { opacity: 0, transform: 'scale(0.55)' },
          { opacity: 1, transform: 'scale(1.08)', offset: 0.6 },
          { opacity: 1, transform: 'scale(1)' },
        ],
        { duration: 320, delay, easing: 'cubic-bezier(0.34,1.56,0.64,1)', fill: 'backwards' },
      )
      el.animate(
        [
          { boxShadow: '0 0 0 0 rgba(255,150,40,0)' },
          { boxShadow: '0 0 10px 1px rgba(255,150,40,0.45)', offset: 0.35 },
          { boxShadow: '0 0 0 0 rgba(255,150,40,0)' },
        ],
        { duration: 520, delay, easing: 'ease' },
      )
    }
  }, [orderKey, containerRef])
}
