import { useEffect, useState } from 'react'
import {
  approveBur,
  burActions,
  burPageUrl,
  burStatusText,
  readBur,
  rejectBur,
  viewerBooruLevel,
  type Bur,
} from '../client/booruBur'
import { useOnScreen } from './useOnScreen'

// The card under Neru-chan's "Filed BUR #n" reply (client/booruBur.ts says
// where the pointer comes from and who may decide). Read live, as the viewer:
// what the BUR says, where it stands, and -- for an admin -- Approve and
// Reject. Fixed-height rows like the poll's, so a status changing never
// re-lays-out the message.
//
// LIVE, NOT REMEMBERED. Re-read while on screen: every 3 s while the booru is
// running it, every 30 s while it waits (another admin may decide it on the
// booru's own page). Off screen it is not polled; it reads again on return.

const POLL_RUNNING_MS = 3000
const POLL_WAITING_MS = 30000

export function BurCard({ id }: { id: number }) {
  const { ref, onScreen } = useOnScreen<HTMLDivElement>()
  const [bur, setBur] = useState<Bur | null>(null)
  const [level, setLevel] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!onScreen) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    void Promise.all([readBur(id), viewerBooruLevel()])
      .then(([b, l]) => {
        if (!alive) return
        setBur(b)
        setLevel(l)
        setError(null)
        if (b.status === 'processing' || b.status === 'pending') {
          timer = setTimeout(() => setTick((t) => t + 1), b.status === 'processing' ? POLL_RUNNING_MS : POLL_WAITING_MS)
        }
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [id, onScreen, tick])

  const decide = (verb: 'approve' | 'reject') => {
    setBusy(verb)
    setError(null)
    void (verb === 'approve' ? approveBur(id) : rejectBur(id))
      .then((b) => setBur(b))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        setBusy(null)
        // Re-read either way: a refusal may still have changed the status,
        // and an approval moves on to processing and then to its outcome.
        setTick((t) => t + 1)
      })
  }

  const actions = bur ? burActions(bur, level) : { approve: false, reject: false }

  return (
    <div ref={ref} className="tc-bur" data-status={bur?.status ?? 'unknown'}>
      <div className="tc-bur-head">
        <a href={burPageUrl(id)} target="_blank" rel="noreferrer noopener" className="tc-bur-title">
          BUR #{id}
        </a>
        <span className="tc-bur-status">
          {busy === 'approve'
            ? 'approving…'
            : busy === 'reject'
            ? 'rejecting…'
            : bur
            ? burStatusText(bur.status)
            : error
            ? 'could not be read'
            : 'reading…'}
        </span>
      </div>
      {bur && bur.lines.length > 0 && (
        <ol className="tc-bur-script">
          {bur.lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      )}
      {(actions.approve || actions.reject) && (
        <div className="tc-bur-actions">
          {actions.approve && (
            <button type="button" className="tc-bur-btn" data-verb="approve" disabled={busy !== null} onClick={() => decide('approve')}>
              Approve
            </button>
          )}
          {actions.reject && (
            <button type="button" className="tc-bur-btn" data-verb="reject" disabled={busy !== null} onClick={() => decide('reject')}>
              Reject
            </button>
          )}
        </div>
      )}
      {error && <div className="tc-bur-error">{error}</div>}
    </div>
  )
}
