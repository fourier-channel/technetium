import { useEffect, useRef, useState } from 'react'

// ---------------------------------------------------------------------------
// "Is this on screen right now?"
//
// Used to decide when an image's tags are worth reading live from the booru.
// The timeline mounts every loaded message, so mounting is not a signal that
// anyone is looking -- a page of forty pictures would be forty requests for
// thirty-four images nobody has scrolled to.
//
// WHY NOT useReplayOnView. That hook answers a similar question and was the
// first thing tried, but its contract is wrong here in a way that fails
// SILENTLY: it requires 75% of the element to be visible, which is right for
// "play this animation where the viewer can see it" and wrong for a tall tag
// panel beside a tall picture. An image taller than the viewport would never
// reach 75%, so its tags would never refresh, and nothing would report it --
// the panel would just keep showing whatever Matrix had. Any fraction, plus
// runway, is the contract this needs.
//
// The runway matches AuthedImage's: the picture starts loading about a screen
// and a half out, and its tags should be there when it arrives rather than
// popping in a moment later.
//
// NO OBSERVER MEANS ON SCREEN. A browser without IntersectionObserver must see
// stale tags, not no tags -- a missing capability may never be the reason a
// feature silently does nothing.
// ---------------------------------------------------------------------------

const RUNWAY = '800px 0px'

export function useOnScreen<T extends Element>(enabled = true): {
  ref: React.RefObject<T | null>
  onScreen: boolean
} {
  const ref = useRef<T | null>(null)
  const [onScreen, setOnScreen] = useState(false)

  useEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      // Off the effect body: a synchronous setState in an effect is the
      // cascading-render rule this repo enforces.
      queueMicrotask(() => setOnScreen(true))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setOnScreen(entry.isIntersecting)
      },
      { rootMargin: RUNWAY, threshold: 0 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [enabled])

  return { ref, onScreen }
}
