import { useEffect, useRef, type RefObject } from 'react'
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
