import { useEffect, useRef, useState } from 'react'
import type { BubbleTone } from '../client/bubbleTone'
import { PILL_MS, fxDurationMs, toneAnimates } from '../client/bubbleFx'

// ---------------------------------------------------------------------------
// Sequencing for the bubble animators (ui-depth-v1 U5).
//
// Three phases, and the bubble's look is driven entirely from which one it is
// in:
//
//   pill     the ordinary pill in this tone's colours. Every animator opens
//            here, because that is the ask: "render the default pill first".
//   playing  the pop / the morph / the question marks.
//   settled  the final shape, held forever, with no animation attached.
//
// PLAY ONCE, on first sight. Not useReplayOnView, which is right for an arrival
// (rare, and worth seeing again) and wrong here: three of the four tones
// animate, so replaying on every entry would turn an ordinary scroll through
// the log into a light show. A message plays when it first comes into view --
// which is when it arrives, for anyone reading live -- and then it is a shape.
//
// The advance out of `playing` is a TIMER, never animationend (G-tc06,
// G-04f01d): an animation that is a no-op never fires its end event, and a row
// waiting for one would hold its question marks forever.
//
// Reduced motion, and animations switched off: straight to `settled`. The final
// shape with no motion, which is the point of the setting -- not the pill, and
// not nothing.
// ---------------------------------------------------------------------------

export type BubblePhase = 'pill' | 'playing' | 'settled'

// Enough of the bubble must be showing to count as seen, so a row clipped at
// the edge of the scroller does not burn its animation before anyone can watch
// it. Same threshold and the same reasoning as useReplayOnView.
const VISIBLE_FRACTION = 0.6

export function useBubbleFx(
  tone: BubbleTone | null,
  animated: boolean,
): { ref: React.RefObject<HTMLDivElement | null>; phase: BubblePhase } {
  const ref = useRef<HTMLDivElement | null>(null)
  const willPlay = !!tone && toneAnimates(tone) && animated
  const [phase, setPhase] = useState<BubblePhase>(() => (willPlay ? 'pill' : 'settled'))

  useEffect(() => {
    // queueMicrotask, as everywhere else in this tree: a synchronous setState
    // in an effect body is what G-tc01 forbids, and the linter counts it.
    if (!willPlay) {
      // Covers the switch being turned OFF while a row is on screen: the bubble
      // lands on its final shape rather than being frozen mid-pop.
      queueMicrotask(() => setPhase('settled'))
      return
    }
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      // No observer to ask (a test environment, an ancient engine). Show the
      // final shape rather than leaving every bubble stuck as a pill --
      // "unmeasured never renders as healthy", and a pill that never becomes a
      // burst is indistinguishable from a message that was never a shout.
      queueMicrotask(() => setPhase('settled'))
      return
    }

    let timers: ReturnType<typeof setTimeout>[] = []
    const start = () => {
      timers.push(setTimeout(() => setPhase('playing'), PILL_MS))
      timers.push(setTimeout(() => setPhase('settled'), PILL_MS + fxDurationMs(tone)))
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= VISIBLE_FRACTION) {
            // Once. The observer goes the moment it has fired, so nothing keeps
            // watching a row whose performance is over.
            io.disconnect()
            start()
          }
        }
      },
      { threshold: [0, VISIBLE_FRACTION, 1] },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      for (const t of timers) clearTimeout(t)
      timers = []
    }
    // `tone` is read inside start(); a row's tone changes only when its text is
    // edited, and re-running the whole sequence for an edit is correct.
  }, [willPlay, tone])

  return { ref, phase }
}
