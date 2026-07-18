import { type CSSProperties } from 'react'
import { ONBOARDING_ASSETS } from './assets'
import { AssetImage } from './AssetImage'
import { SilentBoundary } from './SilentBoundary'

// ---------------------------------------------------------------------------
// The pre-client boot moment (starting / connecting-before-a-client-exists).
// It MOVES -- a little signal spectrum pulsing under the wordmark -- so the user
// can see the app is alive and working, never a dead "Loading" (onboarding-ux-
// law). Once a client exists we drop this and mount the real shell with the
// cached room list, so this screen is only ever shown for a beat.
// ---------------------------------------------------------------------------

const BARS = [0, 1, 2, 3, 4, 5, 6]

export function BootScreen({ label }: { label: string }) {
  return (
    <div style={shell}>
      <style>{`
        @keyframes bootBar { 0%,100% { transform: scaleY(0.35); } 50% { transform: scaleY(1); } }
        @media (prefers-reduced-motion: reduce) { .boot-bar { animation: none !important; transform: scaleY(0.7); } }
      `}</style>
      <div style={column}>
        <SilentBoundary>
          <AssetImage asset={ONBOARDING_ASSETS.logo} imgStyle={{ height: 44 }} textStyle={wordmark} />
        </SilentBoundary>

        <div style={spectrum} aria-hidden>
          {BARS.map((i) => (
            <span
              key={i}
              className="boot-bar"
              style={{
                width: 4,
                height: 22,
                borderRadius: 2,
                transformOrigin: 'center',
                background: 'var(--cpd-color-bg-accent-rest, #3390ff)',
                animation: `bootBar 900ms ease-in-out ${i * 90}ms infinite`,
              }}
            />
          ))}
        </div>

        <div style={labelStyle} role="status" aria-live="polite">
          {label}
          {'…'}
        </div>
      </div>
    </div>
  )
}

const shell: CSSProperties = {
  height: '100vh',
  width: '100%',
  display: 'grid',
  placeItems: 'center',
  background: 'var(--cpd-color-bg-canvas-default)',
}

const column: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 20,
}

const wordmark: CSSProperties = {
  fontFamily: 'var(--tc-ui-font, sans-serif)',
  fontSize: 26,
  fontWeight: 700,
  letterSpacing: '-0.02em',
  color: 'var(--cpd-color-text-primary)',
}

const spectrum: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  height: 24,
}

const labelStyle: CSSProperties = {
  fontFamily: 'var(--tc-ui-font, inherit)',
  fontSize: 13,
  color: 'var(--cpd-color-text-secondary)',
}
