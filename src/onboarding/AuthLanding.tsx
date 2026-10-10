import { type CSSProperties, type ReactNode } from 'react'
import { SilentBoundary } from './SilentBoundary'
import { AssetImage } from './AssetImage'
import { ONBOARDING_ASSETS } from './assets'
import { FourierSay } from './FourierSay'
import { FOURIER_INTRO } from './fourierIntro'
import { Pip2Link } from '../ui/Pip2Link'
import { SignOutStatus } from '../ui/SignOutStatus'
import { SiteReset } from '../ui/SiteReset'

// ---------------------------------------------------------------------------
// The first thing a visitor sees: logo, then two clear doors -- Create account
// / Log in -- each going straight to the secure sign-in.
//
// There is no walkthrough here any more (operator, 2026-09-27): "Tc's
// onboarding is *replaced* with these MAS changes. It's moving Fourier's
// instructions from before the login flow, onto the login flow itself."
// Fourier now speaks on the sign-in pages themselves (synapse-deploy's MAS
// templates), where each line sits beside the thing it explains, so this
// screen only opens the right door: Create account asks MAS for its register
// page, Log in for its login page. Nothing is on rails (onboarding-ux-law).
//
// Except her intro. Both doors go straight to MAS's login or register page
// and skip its start page, so the intro she says there is said HERE, or her
// later lines would follow nothing (operator, 2026-09-27). It is the same
// line from the same map, generated into fourierIntro.ts.
// ---------------------------------------------------------------------------

export function AuthLanding({ onProceed }: { onProceed: (intent?: 'create') => void }) {
  return (
    <div className="tc-screen-min" style={shell}>
      <style>{`
        @keyframes tcRise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .tc-rise { animation: none !important; } }
      `}</style>

      {/* faint signal grid -- alive, not stale, and quietly on-brand */}
      <div aria-hidden style={grid} />

      <div className="tc-rise" style={column}>
        <FourierSay lines={FOURIER_INTRO} />
        <SilentBoundary>
          <AssetImage
            asset={ONBOARDING_ASSETS.logo}
            imgStyle={{ height: 56, width: 'auto' }}
            textStyle={wordmark}
          />
        </SilentBoundary>

        <p style={tagline}>A Discord-shaped home for 41chan.</p>
        <div style={actions}>
          <Button kind="primary" onClick={() => onProceed('create')}>
            Create account
          </Button>
          <Button kind="ghost" onClick={() => onProceed()}>
            Log in
          </Button>
        </div>
        <p style={betaNotice}>
          Technetium is a custom client that contains many features otherwise
          invisible to users on other clients. These features are in beta, so
          some may not work properly. Please report anything that feels
          "wrong" or "off", as UI satisfaction is the number one goal.
        </p>
        {/* What 41chan does with what it learns about you, before you give it
            anything: PIP2, the one page every surface links. */}
        <p style={pipLine}>
          <Pip2Link full />
        </p>
        {/* Purge and hard refresh, signed out as well as in (PIP2 claims
            sweep, operator remedy 2): the SAME component the room list's
            header carries, so the two cannot drift apart. In flow and always
            present, so it moves nothing when the screen draws. */}
        <div style={resetBox}>
          <SiteReset />
        </div>
      </div>
      {/* After a logout: the booru and token half of it, running or done. */}
      <SignOutStatus />
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
          color: 'var(--cpd-color-text-on-solid-primary)',
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

const shell: CSSProperties = {
  position: 'relative',
  // At least the visible screen (.tc-screen-min), and taller when her intro
  // and the doors need it: a short phone scrolls rather than clipping the doors.
  boxSizing: 'border-box',
  paddingBlock: 24,
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

const betaNotice: CSSProperties = {
  margin: '2px 0 0',
  fontFamily: 'var(--tc-ui-font, inherit)',
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--cpd-color-text-secondary)',
  textAlign: 'center',
  opacity: 0.85,
  maxWidth: 340,
}

const pipLine: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--tc-ui-font, inherit)',
  fontSize: 12,
  textAlign: 'center',
}

// The rectangle's own width, not the column's: two symbols across 380px
// would read as a bar, not as two buttons.
const resetBox: CSSProperties = {
  width: 128,
}

const actions: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  width: '100%',
  alignItems: 'stretch',
}
