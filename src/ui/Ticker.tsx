import { useEffect, useRef, useState } from 'react'
import type { TickerItem, TickerSource } from './tickerSource'

// The dedicated strip above the chat box: one slow, continuous crawl. The
// run is rendered twice back to back and the track animates by exactly half
// its own width, so the loop point is invisible. Hover pauses it; reduced
// motion stills it entirely (index.css owns both).
const SPEED_PX_PER_S = 28

export function Ticker({
  source,
  collapsed = false,
  onToggle,
}: {
  source: TickerSource
  // Collapsed shows only a slim re-expand strip; the crawl and its layout
  // cost are gone entirely. State is the caller's (account data).
  collapsed?: boolean
  onToggle?: () => void
}) {
  const [items, setItems] = useState<TickerItem[]>([])
  const trackRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => source.subscribe(setItems), [source])

  // Duration follows content width so the crawl SPEED stays constant however
  // much the source delivers. Written straight onto the element -- no state,
  // no re-render; one layout read after each delivery.
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const half = track.scrollWidth / 2
    track.style.setProperty('--tc-ticker-ms', `${Math.max(8_000, Math.round((half / SPEED_PX_PER_S) * 1000))}ms`)
  }, [items])

  if (items.length === 0) return null

  if (collapsed) {
    return (
      <div className="tc-ticker tc-ticker--collapsed">
        {onToggle && (
          <button type="button" className="tc-ticker-toggle" onClick={onToggle} aria-label="Expand ticker" title="Expand ticker">
            &#9662;
          </button>
        )}
      </div>
    )
  }

  const run = (suffix: string, hidden: boolean) => (
    <div className="tc-ticker-run" aria-hidden={hidden || undefined}>
      {items.map((item) => (
        <span key={`${item.id}${suffix}`} className="tc-ticker-item">
          {item.href
            ? <a href={item.href} target="_blank" rel="noreferrer">{item.text}</a>
            : item.text}
        </span>
      ))}
    </div>
  )

  return (
    <div className="tc-ticker" aria-label="ticker">
      <div className="tc-ticker-track" ref={trackRef}>
        {run('', false)}
        {run(':loop', true)}
      </div>
      {onToggle && (
        <button type="button" className="tc-ticker-toggle" onClick={onToggle} aria-label="Collapse ticker" title="Collapse ticker">
          &#9652;
        </button>
      )}
    </div>
  )
}
