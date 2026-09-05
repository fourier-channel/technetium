import { type CSSProperties } from 'react'
import {
  cryptoPercent,
  cryptoProgressLabel,
  shouldShowCryptoBox,
  type CryptoLoadState,
} from '../client/cryptoProgress'

// ---------------------------------------------------------------------------
// The crypto engine's arrival, shown rather than hidden (D-e6).
//
// This exists because a one-time multi-megabyte fetch that happens silently at
// login is indistinguishable from a hang, and the onboarding-ux law says a user
// must never be left looking at a stalled surface with no account of what it is
// doing. It is shown once, effectively ever: the asset is content-hashed and
// served immutable, so it is not re-fetched on later logins or deploys.
//
// The box states plainly what it is installing and what that will and will not
// encrypt, because "encryption is on" without a scope is the kind of half-truth
// that makes people trust the wrong room.
// ---------------------------------------------------------------------------

export function KeysArrival({ state, onDismiss }: { state: CryptoLoadState; onDismiss?: () => void }) {
  if (!shouldShowCryptoBox(state)) return null

  const pct = cryptoPercent(state)
  const failed = state.phase === 'failed'

  return (
    <div style={scrim} role="dialog" aria-modal="true" aria-labelledby="keys-arrival-title">
      <div style={box}>
        {/* Deliberate spelling and spacing -- the operator's title, verbatim. */}
        <div id="keys-arrival-title" style={title}>
          A r gh   the  Ke  y    s
        </div>

        <p style={body}>
          Retrieving and installing the vodozemac encryption module. End-to-End
          Encryption (E2EE) will be active in private chats by default. It will
          be otherwise inactive in most rooms on this server.
        </p>

        <div
          style={track}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          // Omitted entirely when indeterminate: an aria-valuenow of 0 claims
          // "no progress", which is a different statement from "unknown".
          aria-valuenow={pct === null ? undefined : Math.round(pct)}
        >
          <div
            data-keys-fill
            style={{
              ...fill,
              width: pct === null ? '100%' : `${pct}%`,
              opacity: failed ? 0.35 : 1,
              background: failed
                ? 'var(--cpd-color-text-critical-primary, #d6483b)'
                : 'var(--cpd-color-bg-accent-rest, #3390ff)',
              // An unknown total gets a moving stripe, never a filled bar --
              // a full bar that is not full is a lie (G-e3).
              animation: pct === null && !failed ? 'keysIndeterminate 1200ms linear infinite' : undefined,
            }}
          />
        </div>

        <div style={failed ? { ...meta, color: 'var(--cpd-color-text-critical-primary, #d6483b)' } : meta}
             role="status" aria-live="polite">
          {cryptoProgressLabel(state)}
        </div>

        {failed && onDismiss && (
          // The way on. The message above already told the truth about the
          // consequence; trapping the reader behind it taught nothing more.
          <button type="button" onClick={onDismiss} style={continueBtn} data-keys-continue autoFocus>
            Continue without encryption
          </button>
        )}

        <style>{`
          @keyframes keysIndeterminate {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
          }
          @media (prefers-reduced-motion: reduce) {
            [data-keys-fill] { animation: none !important; }
          }
        `}</style>
      </div>
    </div>
  )
}

const scrim: CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(0,0,0,0.55)',
  zIndex: 9000,
}

const box: CSSProperties = {
  width: 'min(30rem, calc(100vw - 2rem))',
  padding: '1.5rem',
  borderRadius: 12,
  background: 'var(--cpd-color-bg-canvas-default, #101317)',
  border: '1px solid var(--cpd-color-gray-400, #33373d)',
  boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
  color: 'var(--cpd-color-text-primary, #e9eaeb)',
}

const title: CSSProperties = {
  fontFamily: 'Inconsolata, monospace',
  fontSize: '1.35rem',
  letterSpacing: '0.02em',
  marginBottom: '0.75rem',
  whiteSpace: 'pre-wrap',
}

const body: CSSProperties = {
  margin: '0 0 1.25rem',
  fontSize: '0.9rem',
  lineHeight: 1.5,
  color: 'var(--cpd-color-text-secondary, #a9b2bc)',
}

const track: CSSProperties = {
  height: 8,
  borderRadius: 4,
  overflow: 'hidden',
  background: 'var(--cpd-color-gray-300, #26292d)',
}

const fill: CSSProperties = {
  height: '100%',
  borderRadius: 4,
  transition: 'width 180ms linear',
}

const meta: CSSProperties = {
  marginTop: '0.6rem',
  fontSize: '0.8rem',
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--cpd-color-text-secondary, #a9b2bc)',
}

const continueBtn: CSSProperties = {
  marginTop: 14,
  padding: '8px 18px',
  borderRadius: 8,
  border: '1px solid var(--cpd-color-border-interactive-primary, #4a4a4a)',
  background: 'transparent',
  color: 'var(--cpd-color-text-primary, #e7ebf0)',
  font: 'inherit',
  cursor: 'pointer',
}
