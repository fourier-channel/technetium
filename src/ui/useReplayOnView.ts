import { useEffect, useRef, useState } from 'react'

// ---------------------------------------------------------------------------
// "Play once each time this scrolls into view."
//
// Returns a ref to attach and a counter that increments on every fresh entry
// into the viewport -- 0 means it has not been seen yet. Used as a React `key`
// on the animated node, so the node remounts and its CSS animation restarts
// from the beginning; restarting an animation by toggling a class is unreliable
// without forcing a reflow, and a remount is honest about what it is doing.
//
// The design intent: the animation fires on a deliberate act. Scrolling to a
// message is something the viewer chose to do, so replaying there is a reward
// rather than an interruption -- and a viewer who just wants to read the log
// scrolls past each one exactly once.
//
// A row must LEAVE before it can play again, so a partial scroll that jiggles
// the boundary does not retrigger it.
// ---------------------------------------------------------------------------

// Enough of the row must be showing to count as "in view". High enough that a
// row half-clipped at the edge of the scroller does not burn its animation
// before the viewer can see it.
const VISIBLE_FRACTION = 0.75

export function useReplayOnView(enabled: boolean): {
  ref: React.RefObject<HTMLDivElement | null>
  playKey: number
} {
  const ref = useRef<HTMLDivElement | null>(null)
  const [playKey, setPlayKey] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return

    // Held here rather than in state: it is edge-detection bookkeeping, and
    // putting it in state would re-render the row on every scroll crossing.
    let inView = false

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const visible = entry.isIntersecting && entry.intersectionRatio >= VISIBLE_FRACTION
          if (visible && !inView) {
            inView = true
            setPlayKey((k) => k + 1)
          } else if (!visible && inView) {
            inView = false
          }
        }
      },
      // Default root: the viewport. An ancestor scroller's clipping is already
      // folded into the intersection rect, so the timeline's own overflow is
      // accounted for without having to thread its element down here.
      { threshold: [0, VISIBLE_FRACTION, 1] },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [enabled])

  return { ref, playKey }
}
