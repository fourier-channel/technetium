import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useClient } from '../client/clientContextValue'
import { PURGE_QUESTION, refreshUrls } from '../client/browserPurge'
import { usePopupAt, usePopupFocus } from './popupFocus'

// ---------------------------------------------------------------------------
// Hard refresh and purge, one rectangle, each half the option, under your name
// card (operator, 2026-10-03: "a convenient browser purge option and a
// force-hard-refresh button on every possible surface ... put both the purge
// and refresh in a shared rectangle"; placement ruled the same day).
//
// REFRESH refetches the page and every same-origin file it loaded past the
// browser's cache, then reloads onto the fresh copies.
//
// PURGE asks first -- in place, never a browser popup, which steals focus --
// then signs out and deletes everything this client stored in the browser
// EXCEPT the encryption keys (ruling: keys only via the reset in Settings >
// Encryption; client/browserPurge.ts says why), and reloads.
// ---------------------------------------------------------------------------

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
        onClick={hardRefresh}
        title="Reload Technetium, fetching the page and every file it uses from the server again"
      >
        Refresh
      </button>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={asking !== null}
        onClick={() => (asking ? setAsking(null) : ask())}
        title="Sign out and delete what Technetium stored in this browser, except your encryption keys"
      >
        Purge
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
        Purge signs you out of Technetium and deletes everything it stored in this browser except your encryption
        keys, so your encrypted messages still open when you sign back in. To delete the keys as well, use the reset
        in Settings &gt; Encryption.
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
