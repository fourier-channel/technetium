import { useEffect, useRef } from 'react'
import { clearDrench, useDrench } from './drench'

// Droplets left on a row that was caught in a squirt.
//
// Absolutely positioned inside the row (.tc-row is position: relative) and
// pointer-events: none, so it holds no layout and cannot move, block or reflow
// a message (G-tp19). The count and placement are fixed rather than random:
// re-randomising on every render would make the droplets crawl around the
// message while it sat there, and a random value read during render is against
// the rules anyway (G-tc01).
//
// Renders null when dry, which is almost always -- this sits on every row, so
// the cheap path has to be the empty one.

const DROPS = [
  { left: '12%', top: '18%', scale: 1 },
  { left: '31%', top: '58%', scale: 0.7 },
  { left: '47%', top: '24%', scale: 0.85 },
  { left: '63%', top: '66%', scale: 0.6 },
  { left: '74%', top: '30%', scale: 0.95 },
  { left: '88%', top: '54%', scale: 0.7 },
]

export function Drench({ rowId }: { rowId: string }) {
  const state = useDrench(rowId)
  const ref = useRef<HTMLSpanElement | null>(null)
  const wet = !!state

  // Scrolled out of view means gone for good (D-in08): it never comes back when
  // the row scrolls into view again. The timeline is NOT windowed -- every
  // loaded event stays in the DOM -- so leaving the viewport has to be observed
  // explicitly; waiting for an unmount that only happens when the event falls
  // out of the loaded timeline would keep the water there for hours.
  useEffect(() => {
    if (!wet) return
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => !e.isIntersecting)) clearDrench(rowId)
      },
      { threshold: 0 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [wet, rowId])

  if (!state) return null

  return (
    <span
      ref={ref}
      className="tc-drench"
      data-level={state.level}
      data-drying={state.drying ? 'true' : undefined}
      aria-hidden="true"
    >
      {DROPS.slice(0, state.level === 'primary' ? DROPS.length : 3).map((d, i) => (
        <span
          key={i}
          className="tc-drop"
          style={
            {
              left: d.left,
              top: d.top,
              '--tc-drop-scale': String(d.scale),
              // Staggered so they break up raggedly instead of in formation.
              '--tc-drop-delay': `${i * 70}ms`,
            } as React.CSSProperties
          }
        />
      ))}
    </span>
  )
}
