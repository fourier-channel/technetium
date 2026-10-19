import { useEffect, useState } from 'react'
import {
  oldVersionText,
  readReplacement,
  replacementOffer,
  setRetention,
  type Replacement,
} from '../client/booruReplacement'
import { useNow } from './useNow'
import { useOnScreen } from './useOnScreen'

// The card under Neru-chan's "post #n now has the new version" reply
// (client/booruReplacement.ts). Everyone sees what happens to the old version;
// the creator, while the booru allows it, can change their mind. Read live
// while on screen -- every minute, which is the finest the countdown speaks.

const POLL_MS = 60_000

export function ReplacementCard({ id }: { id: number }) {
  const { ref, onScreen } = useOnScreen<HTMLDivElement>()
  const now = useNow()
  const [r, setR] = useState<Replacement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!onScreen) return
    let alive = true
    const timer = setTimeout(() => setTick((t) => t + 1), POLL_MS)
    void readReplacement(id)
      .then((x) => {
        if (alive) {
          setR(x)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [id, onScreen, tick])

  const offer = r ? replacementOffer(r) : null
  const change = () => {
    if (!offer) return
    setBusy(true)
    setError(null)
    void setRetention(id, offer)
      .then((x) => setR(x))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        setBusy(false)
        setTick((t) => t + 1)
      })
  }

  return (
    <div ref={ref} className="tc-bur tc-replacement" data-status={r?.retention ?? 'unknown'}>
      <div className="tc-bur-head">
        <span className="tc-bur-title">Old version</span>
        <span className="tc-bur-status">{busy ? 'asking the booru…' : r ? oldVersionText(r, now) : error ? 'could not be read' : 'reading…'}</span>
      </div>
      {offer && (
        <div className="tc-bur-actions">
          <button type="button" className="tc-bur-btn" disabled={busy} onClick={change}>
            {offer === 'keep' ? 'Keep the old version' : 'Let the old version go'}
          </button>
        </div>
      )}
      {error && <div className="tc-bur-error">{error}</div>}
    </div>
  )
}
