import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk'
import { eventPreview } from '../client/eventPreview'
import { REPORT_REASON_MAX, reportFailureText, sendReport } from '../client/contentReport'
import { reportIgnored } from '../client/report'

// Report a message to the moderators (ing.67). A modal for the same reason
// Delete is one: the action bar sits under the pointer.
//
// Every stage is shown as it happens (writing, sending, sent, failed); the
// dialog never closes on its own, so "it went" is something the person reads,
// not something they infer from a dialog vanishing.
type Stage = { s: 'writing' } | { s: 'sending' } | { s: 'sent' } | { s: 'failed'; text: string }

export function ReportDialog({
  client,
  target,
  onClose,
}: {
  client: MatrixClient
  target: MatrixEvent
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [stage, setStage] = useState<Stage>({ s: 'writing' })
  const busy = stage.s === 'sending'

  const send = () => {
    const roomId = target.getRoomId()
    const eventId = target.getId()
    if (!roomId || !eventId || busy) return
    setStage({ s: 'sending' })
    sendReport(client, roomId, eventId, reason).then(
      () => setStage({ s: 'sent' }),
      (err: unknown) => {
        // Shown to the person in plain words; the detail goes to the console
        // (G-tc05: a swallow is reported at the moment it happens).
        reportIgnored('report a message', err)
        setStage({ s: 'failed', text: reportFailureText(err) })
      },
    )
  }

  const close = () => {
    if (!busy) onClose()
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Report message"
      onClick={close}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(0,0,0,0.5)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          maxWidth: 'calc(100vw - 32px)',
          padding: 18,
          borderRadius: 12,
          fontFamily: 'var(--tc-ui-font, inherit)',
          color: 'var(--cpd-color-text-primary)',
          background: 'var(--cpd-color-bg-canvas-default)',
          border: '1px solid rgba(128,128,128,0.35)',
          boxShadow: '0 16px 44px rgba(0,0,0,0.55)',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Report message</div>
        <div
          style={{
            fontSize: 12,
            padding: '6px 10px',
            marginBottom: 12,
            borderRadius: 6,
            borderLeft: '3px solid rgba(128,128,128,0.5)',
            background: 'var(--cpd-color-bg-subtle-secondary)',
            color: 'var(--cpd-color-text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {eventPreview(target, 90)}
        </div>

        {stage.s === 'sent' ? (
          <div role="status" style={{ fontSize: 13, marginBottom: 14 }}>
            Sent to the moderators. Thank you for telling us.
          </div>
        ) : (
          <>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--cpd-color-text-secondary)', marginBottom: 6 }}>
              What is wrong with it? The moderators read this. (optional)
              <textarea
                value={reason}
                maxLength={REPORT_REASON_MAX}
                disabled={busy}
                autoFocus
                rows={3}
                onChange={(e) => setReason(e.target.value)}
                style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 6, fontSize: 13, resize: 'vertical' }}
              />
            </label>
            <div style={{ fontSize: 12, color: 'var(--cpd-color-text-secondary)', marginBottom: 12 }}>
              The person you report is not told who reported them.
            </div>
            {stage.s === 'failed' && (
              <div role="alert" style={{ fontSize: 13, marginBottom: 12, color: 'var(--cpd-color-text-critical-primary, #ff6b6b)' }}>
                {stage.text}
              </div>
            )}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {stage.s === 'sent' ? (
            <button type="button" onClick={onClose} autoFocus style={{ fontSize: 13, padding: '5px 12px' }}>
              Close
            </button>
          ) : (
            <>
              <button type="button" onClick={close} disabled={busy} style={{ fontSize: 13, padding: '5px 12px' }}>
                Cancel
              </button>
              <button type="button" onClick={send} disabled={busy} style={{ fontSize: 13, padding: '5px 12px', fontWeight: 600 }}>
                {busy ? 'Sending\u2026' : stage.s === 'failed' ? 'Try again' : 'Send report'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
