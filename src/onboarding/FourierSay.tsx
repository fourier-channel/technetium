import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../ui/reducedMotion'
import { FIRST_BUBBLE_MS, bubbleWait } from './fourierRun'
import { reportIgnored } from '../client/report'
import './fourierSay.css'

// ---------------------------------------------------------------------------
// Fourier speaks a run of bubbles, once, when the landing opens -- the same run
// the MAS sign-in pages play (synapse-deploy mas/templates/components/
// fourier.html), and the same shape as a run of messages in the timeline (L12):
// her avatar hangs in the gutter from the bubble she is saying and slides down
// to the next, and the bubbles she has left lose their arrow.
//
// Every bubble holds its space from the first frame and only fades in, so the
// doors below never move while she talks (no-forced-reflow-law), and a screen
// reader reads the whole run at once. Under reduced motion she has simply said
// it all. Only the last line reserves the avatar's height, since that is where
// she ends.
// ---------------------------------------------------------------------------

// Her portrait is the ONE hosted copy the MAS sign-in pages also show
// (every-image-exists-once), so she has the same face on both sides of the
// sign-in. Tc's CSP restricts frames only, so img-src admits it. Should it
// fail to load she keeps her monogram, as the MAS page does with no portrait,
// and the failure is reported (G-tc05).
const FOURIER_PORTRAIT = 'https://41chan.net/fourier-chan/avatar.png'

export function FourierSay({ lines }: { lines: readonly string[] }) {
  // Read once: the run plays once, so a preference changed mid-run need not
  // restart it.
  const [still] = useState(prefersReducedMotion)
  const [said, setSaid] = useState(() => (still ? lines.length : 0))
  const speaker = Math.max(0, said - 1)
  const avRef = useRef<HTMLSpanElement>(null)
  const lastTop = useRef<number | null>(null)
  const [portraitFailed, setPortraitFailed] = useState(false)

  useEffect(() => {
    if (said >= lines.length) return
    const wait = said === 0 ? FIRST_BUBBLE_MS : bubbleWait(lines[said - 1])
    const t = window.setTimeout(() => setSaid((n) => n + 1), wait)
    return () => window.clearTimeout(t)
  }, [said, lines])

  // The avatar moved to the line she is now saying: slide it from where it was.
  useLayoutEffect(() => {
    const el = avRef.current
    if (!el || said === 0) return
    const top = el.getBoundingClientRect().top
    const was = lastTop.current
    lastTop.current = top
    if (was === null || still || was === top) return
    el.animate([{ transform: `translateY(${was - top}px)` }, { transform: 'translateY(0)' }], {
      duration: 280,
      easing: 'cubic-bezier(.2,.8,.2,1)',
    })
  }, [speaker, said, still])

  return (
    <aside className="fc-say" aria-label="Fourier">
      {lines.map((text, i) => (
        <div
          key={i}
          className="fc-line"
          data-speaks={i === speaker && said > 0 ? '' : undefined}
          data-fc-pending={i >= said ? '' : undefined}
        >
          {i === speaker && (
            <span ref={avRef} className="fc-av" aria-hidden data-fc-pending={said === 0 ? '' : undefined}>
              {portraitFailed ? (
                <span className="fc-mono">{'\u223F'}</span>
              ) : (
                <img
                  className="fc-portrait"
                  src={FOURIER_PORTRAIT}
                  alt=""
                  decoding="async"
                  onError={() => {
                    reportIgnored('fourier portrait', new Error('portrait did not load'))
                    setPortraitFailed(true)
                  }}
                />
              )}
            </span>
          )}
          <p className="fc-bubble">{text}</p>
        </div>
      ))}
    </aside>
  )
}
