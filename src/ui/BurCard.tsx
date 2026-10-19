import { useEffect, useState } from 'react'
import {
  approveBur,
  burActions,
  burPageUrl,
  burStatusText,
  BurRefusal,
  lineStateText,
  readBur,
  rejectBur,
  viewerBooruLevel,
  type Bur,
} from '../client/booruBur'
import { useOnScreen } from './useOnScreen'

// The card under Neru-chan's "Filed BUR #n" reply (client/booruBur.ts says
// where the pointer comes from and who may decide). Read live, as the viewer:
// what the BUR says line by line and how far each line got, who asked (as the
// booru's own text, never as an identity), where it stands, and -- where the
// booru's per-viewer flags allow -- Approve and Reject. A refusal is shown in
// the booru's own words, and a line it names is marked where it stands.
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
  const [lineErrors, setLineErrors] = useState<Map<number, string>>(new Map())
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!onScreen) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    void readBur(id)
      .then(async (b) => {
        // The booru's per-viewer flags decide; the level is only asked for
        // when a booru too old to send them answers without.
        const l = b.canApprove === undefined || b.canReject === undefined ? await viewerBooruLevel() : null
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
    setLineErrors(new Map())
    void (verb === 'approve' ? approveBur(id) : rejectBur(id))
      .then((b) => setBur(b))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        if (err instanceof BurRefusal) setLineErrors(err.lineErrors)
      })
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
      {bur?.reason && <div className="tc-bur-reason">{bur.reason}</div>}
      {bur && bur.lines.length > 0 && (
        <ol className="tc-bur-script">
          {bur.lines.map((l) => {
            const state = lineStateText(l)
            const refused = lineErrors.get(l.line)
            return (
              <li key={l.line} value={l.line} data-state={l.state ?? undefined} data-refused={refused ? 'true' : undefined}>
                <span className="tc-bur-line">{l.command}</span>
                {state && <span className="tc-bur-line-state"> -- {state}</span>}
                {refused && <div className="tc-bur-line-error">{refused}</div>}
                {l.error && <div className="tc-bur-line-error">{l.error}{l.remedy ? ` ${l.remedy}` : ''}</div>}
                {l.skippedReasons.map((r) => (
                  <div key={r.message} className="tc-bur-line-note">{r.count} skipped: {r.message}</div>
                ))}
              </li>
            )
          })}
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
