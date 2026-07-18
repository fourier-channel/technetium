import { type CSSProperties, type ReactNode } from 'react'
import { hasImage, type Asset } from './assets'

// ---------------------------------------------------------------------------
// Fourier-chan on screen: her portrait + what she's saying. The portrait is an
// "Image TBD" slot -- until the art lands it shows a signal monogram, never the
// line text (that would double up with the speech bubble). Her line IS the
// slot's caption text, so one variable serves the spoken line now and the image
// caption later. A quote (master-doc/devlog, TBD) rides along when present, and
// simply isn't there when it's null (silent-null, CD-9).
// ---------------------------------------------------------------------------

export function FourierChan({ asset, quote }: { asset: Asset; quote?: string | null }) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <Portrait asset={asset} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <SpeechBubble>{asset.text}</SpeechBubble>
        {quote ? <Quote>{quote}</Quote> : null}
      </div>
    </div>
  )
}

function Portrait({ asset }: { asset: Asset }) {
  const box: CSSProperties = {
    width: 64,
    height: 64,
    flexShrink: 0,
    borderRadius: '50%',
    overflow: 'hidden',
    display: 'grid',
    placeItems: 'center',
    background: 'radial-gradient(circle at 30% 30%, #1f6f6a, #12303a)',
    boxShadow: '0 0 0 2px rgba(255,180,80,0.35), 0 4px 14px rgba(0,0,0,0.4)',
  }
  if (hasImage(asset)) {
    return (
      <div style={box}>
        <img src={asset.src} alt={asset.alt ?? asset.text} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    )
  }
  // Placeholder: a signal glyph in her amber, on her teal. Reads as "her".
  return (
    <div style={box} aria-label={asset.alt ?? 'Fourier-chan'}>
      <span style={{ fontSize: 28, color: '#ffb84d', fontWeight: 700, lineHeight: 1 }}>{'∿'}</span>
    </div>
  )
}

function SpeechBubble({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: 'relative',
        background: 'var(--cpd-color-bg-subtle-secondary)',
        border: '1px solid rgba(128,128,128,0.28)',
        borderRadius: 12,
        padding: '10px 13px',
        fontSize: 14,
        lineHeight: 1.45,
        color: 'var(--cpd-color-text-primary)',
      }}
    >
      {children}
    </div>
  )
}

function Quote({ children }: { children: ReactNode }) {
  return (
    <blockquote
      style={{
        margin: '10px 0 0',
        padding: '2px 0 2px 12px',
        borderLeft: '2px solid var(--cpd-color-bg-accent-rest, #3390ff)',
        fontSize: 12.5,
        fontStyle: 'italic',
        color: 'var(--cpd-color-text-secondary)',
      }}
    >
      {children}
    </blockquote>
  )
}
