import { useState, type CSSProperties, type ReactNode } from 'react'
import { SilentBoundary } from './SilentBoundary'
import { AssetImage } from './AssetImage'
import { GuidedFlow } from './GuidedFlow'
import { ONBOARDING_ASSETS } from './assets'

// ---------------------------------------------------------------------------
// The first thing a visitor sees: logo, then two clear doors -- Create account
// / Log in. "Create account" opens a choice node: a guided walkthrough (L3,
// Fourier-chan) or, for people who know what they're doing, a straight shot to
// the account form. The escape hatch is deliberate (onboarding-ux-law): we make
// the obvious path obvious WITHOUT trapping anyone on rails.
//
// L1 wiring: guided + advanced both begin the same OIDC/MAS flow for now; L3
// wraps the guided door with the walkthrough. The choice structure is real.
// ---------------------------------------------------------------------------

export function AuthLanding({ onProceed }: { onProceed: () => void }) {
  const [view, setView] = useState<'home' | 'create' | 'guided'>('home')

  // The guided walkthrough takes over the whole surface; finishing or skipping
  // it starts the same sign-in, Back on step one returns to the choice.
  if (view === 'guided') {
    return <GuidedFlow onProceed={onProceed} onExit={() => setView('create')} />
  }

  return (
    <div style={shell}>
      <style>{`
        @keyframes tcRise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .tc-rise { animation: none !important; } }
      `}</style>

      {/* faint signal grid -- alive, not stale, and quietly on-brand */}
      <div aria-hidden style={grid} />

      <div className="tc-rise" style={column}>
        <SilentBoundary>
          <AssetImage
            asset={ONBOARDING_ASSETS.logo}
            imgStyle={{ height: 56, width: 'auto' }}
            textStyle={wordmark}
          />
        </SilentBoundary>

        {view === 'home' ? (
          <>
            <p style={tagline}>A Discord-shaped home for 41chan.</p>
            <div style={actions}>
              <Button kind="primary" onClick={() => setView('create')}>
                Create account
              </Button>
              <Button kind="ghost" onClick={onProceed}>
                Log in
              </Button>
            </div>
          </>
        ) : (
          <>
            <p style={tagline}>New here, or already know the ropes?</p>
            <div style={actions}>
              <Choice
                title="Walk me through it"
                sub="A short guided setup. Recommended if Matrix is new to you."
                onClick={() => setView('guided')}
                primary
              />
              <Choice
                title="I know what I'm doing"
                sub="Skip the guide -- straight to the account form."
                onClick={onProceed}
              />
            </div>
            <button type="button" style={backLink} onClick={() => setView('home')}>
              {'←'} Back
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function Button({
  children,
  onClick,
  kind,
}: {
  children: ReactNode
  onClick: () => void
  kind: 'primary' | 'ghost'
}) {
  const base: CSSProperties = {
    fontFamily: 'var(--tc-ui-font, inherit)',
    fontSize: 15,
    fontWeight: 600,
    padding: '11px 18px',
    borderRadius: 10,
    cursor: 'pointer',
    minWidth: 150,
    transition: 'transform .08s ease, background .12s ease',
  }
  const style: CSSProperties =
    kind === 'primary'
      ? {
          ...base,
          border: '1px solid transparent',
          background: 'var(--cpd-color-bg-accent-rest, #3390ff)',
          color: '#fff',
        }
      : {
          ...base,
          border: '1px solid rgba(128,128,128,0.4)',
          background: 'transparent',
          color: 'var(--cpd-color-text-primary)',
        }
  return (
    <button
      type="button"
      onClick={onClick}
      style={style}
      onMouseDown={(e) => (e.currentTarget.style.transform = 'translateY(1px)')}
      onMouseUp={(e) => (e.currentTarget.style.transform = 'none')}
      onMouseLeave={(e) => (e.currentTarget.style.transform = 'none')}
    >
      {children}
    </button>
  )
}

function Choice({
  title,
  sub,
  onClick,
  primary,
}: {
  title: string
  sub: string
  onClick: () => void
  primary?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        fontFamily: 'var(--tc-ui-font, inherit)',
        padding: '13px 16px',
        borderRadius: 12,
        cursor: 'pointer',
        border: primary
          ? '1px solid var(--cpd-color-bg-accent-rest, #3390ff)'
          : '1px solid rgba(128,128,128,0.35)',
        background: primary ? 'var(--cpd-color-bg-subtle-primary)' : 'transparent',
        color: 'var(--cpd-color-text-primary)',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cpd-color-bg-subtle-secondary)')}
      onMouseLeave={(e) =>
        (e.currentTarget.style.background = primary ? 'var(--cpd-color-bg-subtle-primary)' : 'transparent')
      }
    >
      <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: 'var(--cpd-color-text-secondary)', marginTop: 2 }}>{sub}</div>
    </button>
  )
}

const shell: CSSProperties = {
  position: 'relative',
  height: '100vh',
  width: '100%',
  display: 'grid',
  placeItems: 'center',
  overflow: 'hidden',
  background: 'var(--cpd-color-bg-canvas-default)',
}

const grid: CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  opacity: 0.5,
  backgroundImage:
    'linear-gradient(rgba(128,128,128,0.10) 1px, transparent 1px),' +
    'linear-gradient(90deg, rgba(128,128,128,0.10) 1px, transparent 1px)',
  backgroundSize: '34px 34px, 34px 34px',
  maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 78%)',
  WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 78%)',
}

const column: CSSProperties = {
  position: 'relative',
  zIndex: 1,
  width: 'min(92vw, 380px)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 18,
  padding: 8,
  animation: 'tcRise 360ms ease-out',
}

const wordmark: CSSProperties = {
  fontFamily: 'var(--tc-ui-font, sans-serif)',
  fontSize: 34,
  fontWeight: 700,
  letterSpacing: '-0.02em',
  color: 'var(--cpd-color-text-primary)',
}

const tagline: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--tc-ui-font, inherit)',
  fontSize: 14,
  color: 'var(--cpd-color-text-secondary)',
  textAlign: 'center',
}

const actions: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  width: '100%',
  alignItems: 'stretch',
}

const backLink: CSSProperties = {
  fontFamily: 'var(--tc-ui-font, inherit)',
  fontSize: 13,
  background: 'none',
  border: 'none',
  color: 'var(--cpd-color-text-secondary)',
  cursor: 'pointer',
  padding: 4,
}
