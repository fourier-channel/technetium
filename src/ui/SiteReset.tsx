import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useClient } from '../client/clientContextValue'
import { PURGE_QUESTION, refreshUrls } from '../client/browserPurge'
import { usePopupAt, usePopupFocus } from './popupFocus'
import { Pip2Link } from './Pip2Link'

// ---------------------------------------------------------------------------
// Hard refresh and purge, one rectangle, each half the option, under your name
// card (operator, 2026-10-03: "a convenient browser purge option and a
// force-hard-refresh button on every possible surface ... put both the purge
// and refresh in a shared rectangle"; placement ruled the same day).
//
// Symbols, not words (operator, 2026-10-03): a bin on the left for purge, the
// recycling mark on the right for the refresh -- the same two drawings on the
// booru, sampling and 41chan.net. Drawn, not typed, like PushpinIcon: the
// recycling character is an emoji in some fonts and a box in others.
//
// REFRESH refetches the page and every same-origin file it loaded past the
// browser's cache, then reloads onto the fresh copies.
//
// PURGE asks first -- in place, never a browser popup, which steals focus --
// then signs out and deletes everything this client stored in the browser
// EXCEPT the encryption keys (ruling: keys only via the reset at the bottom
// of Manage session; client/browserPurge.ts says why), and reloads.
//
// MOUNTED ON EVERY SCREEN THAT HAS NO SESSION TOO (PIP2 claims sweep,
// 2026-10-04: "absent on ... Technetium's signed-out screen"): the landing
// and the error screen carry this same component. Nothing in it needs a
// client. Signed out, purge still signs the browser out of the booru and its
// gate, whose cookies outlive Technetium's own session, and still clears
// what Technetium left in the browser.
// ---------------------------------------------------------------------------

const PURGE_ICON = 'M3.5 6.5h17M9 6.5v-2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M5.5 6.5l1.2 13a1.6 1.6 0 0 0 1.6 1.5h7.4a1.6 1.6 0 0 0 1.6-1.5l1.2-13M10 10.5v6.5M14 10.5v6.5'
const REFRESH_ICON =
  'M8.31 8.78L10.64 4.75Q12 2.4 13.36 4.75L16.07 9.46M16.93 6.27L16.07 9.46L12.89 8.6M18.02 12.81L20.34 16.85Q21.7 19.2 18.98 19.2L13.55 19.19M15.88 21.53L13.55 19.19L15.89 16.87M9.67 19.21L5.02 19.2Q2.3 19.2 3.66 16.85L6.38 12.15M3.19 13L6.38 12.15L7.22 15.33'

function ResetIcon({ d }: { d: string }) {
  return (
    <svg className="tc-site-reset-icon" viewBox="0 0 24 24" width={16} height={16} aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  )
}

function hardRefresh() {
  const entries = (performance.getEntriesByType?.('resource') ?? []) as PerformanceResourceTiming[]
  const urls = refreshUrls(location.href, entries, location.origin)
  void Promise.all(urls.map((u) => fetch(u, { cache: 'reload', credentials: 'same-origin' }).catch(() => null)))
    .then(() => location.reload())
}

export function SiteReset() {
  const { purge } = useClient()
  const [asking, setAsking] = useState<{ x: number; y: number } | null>(null)
  const [purging, setPurging] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)

  const ask = () => {
    const r = box.current?.getBoundingClientRect()
    setAsking(r ? { x: r.left, y: r.bottom + 6 } : { x: 8, y: 8 })
  }
  const go = () => {
    setPurging(true)
    void purge()
  }

  return (
    <div className="tc-site-reset" role="group" aria-label="This browser's copy of Technetium" ref={box}>
      <button
        type="button"
        aria-label="Purge"
        aria-haspopup="dialog"
        aria-expanded={asking !== null}
        onClick={() => (asking ? setAsking(null) : ask())}
        title="Purge: sign out and delete what Technetium stored in this browser, except your encryption keys"
      >
        <ResetIcon d={PURGE_ICON} />
      </button>
      <button
        type="button"
        aria-label="Hard refresh"
        onClick={hardRefresh}
        title="Hard refresh: reload Technetium, fetching the page and every file it uses from the server again"
      >
        <ResetIcon d={REFRESH_ICON} />
      </button>
      {asking && (
        <PurgeQuestion
          x={asking.x}
          y={asking.y}
          purging={purging}
          onGo={go}
          onClose={() => setAsking(null)}
        />
      )}
    </div>
  )
}

function PurgeQuestion({
  x,
  y,
  purging,
  onGo,
  onClose,
}: {
  x: number
  y: number
  purging: boolean
  onGo: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  usePopupAt(ref, x, y)
  usePopupFocus(ref)
  return createPortal(
    <div
      ref={ref}
      className="tc-site-reset-ask"
      role="alertdialog"
      aria-labelledby="tc-purge-q"
      tabIndex={-1}
      style={{ position: 'fixed', left: x, top: y }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
    >
      <p id="tc-purge-q">{PURGE_QUESTION}</p>
      <p className="tc-site-reset-what">
        Purge signs you out of Technetium and the booru, if you are signed in, and deletes everything Technetium
        stored in this browser except your encryption keys, so your encrypted messages still open when you sign
        back in. To delete the keys as well, use the reset
        at the bottom of Manage session. What 41chan keeps, and why: <Pip2Link />.
      </p>
      <div className="tc-site-reset-row">
        <button type="button" className="tc-pill tc-site-reset-go" disabled={purging} onClick={onGo}>
          {purging ? 'Purging...' : 'Purge it'}
        </button>
        <button type="button" className="tc-pill" disabled={purging} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  )
}
