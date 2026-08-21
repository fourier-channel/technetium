import { useEffect, useState } from 'react'
import { useReducedMotion } from './reducedMotion'

// ---------------------------------------------------------------------------
// A panel that arrives and leaves, rather than appearing and vanishing.
//
// Two pieces of state, because they are two different questions. `mounted` is
// "does this exist in the DOM" and `shown` is "is it in its open position".
// Opening needs mounted-then-shown across a frame boundary, because a CSS
// transition only runs if the element was in its closed state for at least one
// frame first -- set both together and the browser has nothing to animate from.
// Closing needs the reverse: un-show now, unmount once the animation is done.
//
// UNMOUNTING IS ON A TIMER, NOT ON transitionend. `transitionend` never fires
// for a no-op property change (G-04f01d), so a panel closed before it had
// finished opening -- or one whose transition was suppressed entirely, as under
// reduced motion -- would never unmount and would sit invisibly over the app
// forever. The timer cannot fail to arrive.
//
// Shared by the domain panel and the thread strip on purpose: the operator's
// requirement is that they appear and hide EXACTLY the same way, and the only
// way two things stay exactly the same is for there to be one of them.
// ---------------------------------------------------------------------------

export interface Reveal {
  /** Render the panel at all. */
  mounted: boolean
  /** Drive the open/closed CSS state from this. */
  shown: boolean
  /** Milliseconds the caller must use for its transition, or motion is off. */
  durationMs: number
}

export function useReveal(open: boolean, durationMs: number): Reveal {
  const reduced = useReducedMotion()
  // Reduced motion does not mean "no panel" -- it means the panel is simply
  // there. Zero duration collapses the choreography without special-casing it
  // anywhere else.
  const duration = reduced ? 0 : durationMs

  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(open)

  useEffect(() => {
    let frame = 0
    let inner = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    if (open) {
      // queueMicrotask, not a bare call: a synchronous setState inside an
      // effect is the cascading-render rule (G-tc01).
      queueMicrotask(() => setMounted(true))
      if (duration === 0) {
        queueMicrotask(() => setShown(true))
      } else {
        // Two frames: one for the closed state to be painted, one to leave it.
        frame = requestAnimationFrame(() => {
          inner = requestAnimationFrame(() => setShown(true))
        })
      }
    } else {
      queueMicrotask(() => setShown(false))
      timer = setTimeout(() => setMounted(false), duration)
    }

    return () => {
      if (frame) cancelAnimationFrame(frame)
      if (inner) cancelAnimationFrame(inner)
      if (timer) clearTimeout(timer)
    }
  }, [open, duration])

  return { mounted, shown, durationMs: duration }
}
