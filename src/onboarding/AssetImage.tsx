import { useState, type CSSProperties } from 'react'
import { hasImage, type Asset } from './assets'

// ---------------------------------------------------------------------------
// Renders an Asset slot: the image if it has a usable `src`, otherwise the
// slot's `text` (which is both the current placeholder and the future caption).
// A broken image load degrades to the same text -- one saving throw, no error
// chrome (CD-9/CD-10). `textStyle` styles the fallback so a wordmark slot can
// read as a wordmark, an avatar slot as initials, etc.
// ---------------------------------------------------------------------------

export function AssetImage({
  asset,
  imgStyle,
  textStyle,
}: {
  asset: Asset
  imgStyle?: CSSProperties
  textStyle?: CSSProperties
}) {
  const [broken, setBroken] = useState(false)

  if (hasImage(asset) && !broken) {
    return (
      <img
        src={asset.src}
        alt={asset.alt ?? asset.text}
        onError={() => setBroken(true)}
        style={imgStyle}
      />
    )
  }
  return <span style={textStyle}>{asset.text}</span>
}
