import { useState, type CSSProperties } from 'react'
import { FourierChan } from './FourierChan'
import { ONBOARDING_ASSETS, ONBOARDING_QUOTES, type Asset } from './assets'

// ---------------------------------------------------------------------------
// The guided walkthrough: Fourier-chan teaches a newcomer the shape of things,
// then hands off to the real sign-in. It TEACHES rather than rails (onboarding-
// ux-law): Back and Skip are present on every screen, progress is always shown,
// and "Skip to the form" ends the guide immediately -- the user is never
// trapped. Finishing and skipping both start the same secure sign-in.
// ---------------------------------------------------------------------------

interface Step {
  key: string
  heading: string
  asset: Asset
  quote: string | null
}

const STEPS: Step[] = [
  { key: 'welcome', heading: 'Welcome', asset: ONBOARDING_ASSETS.fourierWelcome, quote: null },
  { key: 'what', heading: 'What this is', asset: ONBOARDING_ASSETS.fourierWhat, quote: ONBOARDING_QUOTES.what },
  { key: 'account', heading: 'Your account', asset: ONBOARDING_ASSETS.fourierAccount, quote: null },
  { key: 'rooms', heading: 'Joining rooms', asset: ONBOARDING_ASSETS.fourierRooms, quote: ONBOARDING_QUOTES.rooms },
  { key: 'ready', heading: "You're set", asset: ONBOARDING_ASSETS.fourierReady, quote: null },
]

export function GuidedFlow({
  onProceed,
  onExit,
}: {
  // Start the real sign-in (finish the guide, or skip straight to it).
  onProceed: () => void
  // Leave the guide back to the landing (from Back on the first step).
  onExit: () => void
}) {
  const [i, setI] = useState(0)
  const step = STEPS[i]
  const isFirst = i === 0
  const isLast = i === STEPS.length - 1

  const next = () => (isLast ? onProceed() : setI((n) => n + 1))
  const back = () => (isFirst ? onExit() : setI((n) => n - 1))

  return (
    <div style={shell}>
      <div aria-hidden style={grid} />
      <div style={card}>
        {/* progress + escape hatch (always present) */}
        <div style={topRow}>
          <div style={{ display: 'flex', gap: 6 }} aria-label={`Step ${i + 1} of ${STEPS.length}`}>
            {STEPS.map((s, idx) => (
              <span
                key={s.key}
                style={{
                  width: idx === i ? 18 : 6,
                  height: 6,
                  borderRadius: 99,
                  background:
                    idx <= i ? 'var(--cpd-color-bg-accent-rest, #3390ff)' : 'rgba(128,128,128,0.35)',
                  transition: 'width .2s ease, background .2s ease',
                }}
              />
            ))}
          </div>
          <button type="button" style={skipLink} onClick={onProceed}>
            Skip to the form
          </button>
        </div>

        <h2 style={heading}>{step.heading}</h2>
        <FourierChan asset={step.asset} quote={step.quote} />

        <div style={footer}>
          <button type="button" style={ghostBtn} onClick={back}>
            {isFirst ? '← Back' : 'Back'}
          </button>
          <button type="button" style={primaryBtn} onClick={next}>
            {isLast ? 'Create account' : 'Next'}
          </button>
        </div>
      </div>
    </div>
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
  maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 80%)',
  WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 80%)',
}

const card: CSSProperties = {
  position: 'relative',
  zIndex: 1,
  width: 'min(94vw, 460px)',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  padding: 20,
  borderRadius: 16,
  background: 'var(--cpd-color-bg-canvas-default)',
  border: '1px solid rgba(128,128,128,0.28)',
  boxShadow: '0 16px 44px rgba(0,0,0,0.45)',
  fontFamily: 'var(--tc-ui-font, inherit)',
}

const topRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
}

const skipLink: CSSProperties = {
  fontFamily: 'var(--tc-ui-font, inherit)',
  fontSize: 12,
  background: 'none',
  border: 'none',
  color: 'var(--cpd-color-text-secondary)',
  cursor: 'pointer',
  padding: 2,
  textDecoration: 'underline',
}

const heading: CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 700,
  letterSpacing: '-0.01em',
  color: 'var(--cpd-color-text-primary)',
}

const footer: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 10,
  marginTop: 4,
}

const primaryBtn: CSSProperties = {
  fontFamily: 'var(--tc-ui-font, inherit)',
  fontSize: 14,
  fontWeight: 600,
  padding: '9px 16px',
  borderRadius: 10,
  border: '1px solid transparent',
  background: 'var(--cpd-color-bg-accent-rest, #3390ff)',
  color: '#fff',
  cursor: 'pointer',
}

const ghostBtn: CSSProperties = {
  fontFamily: 'var(--tc-ui-font, inherit)',
  fontSize: 14,
  fontWeight: 600,
  padding: '9px 16px',
  borderRadius: 10,
  border: '1px solid rgba(128,128,128,0.4)',
  background: 'transparent',
  color: 'var(--cpd-color-text-primary)',
  cursor: 'pointer',
}
