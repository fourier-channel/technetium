import { useEffect, useRef, useState } from 'react'
import { TTD_MAX, TTD_MIN } from '../client/useDomainMedia'

// ---------------------------------------------------------------------------
// TTD (time-to-depop) control: sets how long media-objects a user posts stay on
// the canvas. Defaults to 60. Clicking it erases the field and shows a blinking
// `#` cursor; typing a number reveals "Hit Enter To Confirm"; Enter commits
// (clamped TTD_MIN..TTD_MAX) and returns focus to whatever was focused before
// the box was clicked. (Range will eventually be gated by power level.)
// ---------------------------------------------------------------------------

function clampTtd(n: number): number {
  return Math.max(TTD_MIN, Math.min(TTD_MAX, Math.round(n)))
}

export function DomainTtdControl({ ttd, onChange }: { ttd: number; onChange: (n: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const prevFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const beginEdit = () => {
    // Remember what had focus so Enter can hand it back.
    prevFocusRef.current = (document.activeElement as HTMLElement) ?? null
    setDraft('') // erase completely on click
    setEditing(true)
  }

  const confirm = () => {
    const n = parseInt(draft, 10)
    if (!Number.isNaN(n)) onChange(clampTtd(n))
    setEditing(false)
    setDraft('')
    const prev = prevFocusRef.current
    prevFocusRef.current = null
    // Return focus explicitly to the prior element (Enter contract).
    if (prev && prev !== inputRef.current && typeof prev.focus === 'function') prev.focus()
  }

  const cancel = () => {
    setEditing(false)
    setDraft('')
  }

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        borderRadius: 8,
        fontFamily: 'var(--tc-ui-font, inherit)',
        fontSize: 12,
        color: 'var(--cpd-color-text-primary)',
        background: 'rgba(0,0,0,0.35)',
        border: '1px solid rgba(128,128,128,0.35)',
        userSelect: 'none',
      }}
    >
      <style>{`@keyframes domainTtdBlink { 0%,49% { opacity: 1 } 50%,100% { opacity: 0 } }`}</style>
      <span style={{ fontWeight: 700, letterSpacing: 0.3, color: 'var(--cpd-color-text-secondary)' }}>TTD</span>

      {editing ? (
        <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
          <input
            ref={inputRef}
            value={draft}
            inputMode="numeric"
            maxLength={3}
            onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirm()
              else if (e.key === 'Escape') cancel()
            }}
            onBlur={confirm}
            style={{
              width: 42,
              boxSizing: 'border-box',
              fontSize: 12,
              padding: '2px 4px',
              textAlign: 'center',
              color: 'var(--cpd-color-text-primary)',
              background: 'transparent',
              border: '1px solid rgba(128,128,128,0.5)',
              borderRadius: 5,
              caretColor: draft === '' ? 'transparent' : 'auto',
            }}
          />
          {draft === '' && (
            // Blinking `#` cursor shown over the empty field.
            <span
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                textAlign: 'center',
                pointerEvents: 'none',
                fontWeight: 700,
                color: 'var(--cpd-color-text-secondary)',
                animation: 'domainTtdBlink 1s step-end infinite',
              }}
            >
              #
            </span>
          )}
          <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--cpd-color-text-secondary)', whiteSpace: 'nowrap' }}>
            {draft === '' ? '' : 'Hit Enter To Confirm'}
          </span>
        </span>
      ) : (
        <button
          type="button"
          onClick={beginEdit}
          title="Time media objects stay on the canvas (seconds)"
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 5,
            border: '1px solid rgba(128,128,128,0.4)',
            background: 'transparent',
            color: 'var(--cpd-color-text-primary)',
            cursor: 'pointer',
          }}
        >
          {ttd}s
        </button>
      )}
    </div>
  )
}
