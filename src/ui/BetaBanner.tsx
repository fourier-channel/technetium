import { useEffect, useRef, useState } from 'react'
import { AnchoredPopup } from './AnchoredPopup'
import { useHoverPin } from './useHoverPin'
import { parseReleaseInfo, releaseLabel, type ReleaseState } from '../client/releaseInfo'

// The beta notice: a permanent strip in the shell header, no dismiss -- a notice
// that can be closed is a notice that was closed. It is ONE centred line, the
// title in amber (NEAR on the formant axis: working, not finished); the text
// behind it is a hover-pin popup (useHoverPin: hover with a mouse, tap to
// pin), so on a phone the header spends one line on it instead of four.
//
// The notice ends with the build it is shown in (client/releaseInfo.ts), read
// once from the release this page was served from, so a bug report can name
// its version.
//
// The last sentence is the operator's, nearly verbatim, because the feedback it
// invites ("I'm not sure what I should be clicking on") is the exact signal the
// onboarding-ux law runs on, and users need to be TOLD that confusion is a
// report worth sending, or they sit on it.
export function BetaBanner() {
  const title = useRef<HTMLButtonElement>(null)
  const pin = useHoverPin(title, 'tc-beta-notice')
  const [build, setBuild] = useState<ReleaseState>(import.meta.env.DEV ? 'dev' : 'checking')
  useEffect(() => {
    if (import.meta.env.DEV) return
    fetch('/release.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: unknown) => {
        const info = parseReleaseInfo(j)
        if (!info) console.warn('release.json is not a release record:', j)
        setBuild(info ?? 'unreadable')
      })
      .catch((err: unknown) => {
        // A missing file falls back to index.html, which is not JSON.
        console.warn('release.json unreadable:', err)
        setBuild('unreadable')
      })
  }, [])
  return (
    <div className="tc-beta-strip" role="note" aria-label="Beta notice">
      <button ref={title} type="button" className="tc-beta-title" aria-haspopup="dialog" {...pin.anchor}>
        TECHNETIUM BETA
      </button>
      {pin.open && (
        <AnchoredPopup key={pin.popupKey} anchorRef={title} label="About the beta" {...pin.popup}>
          Things <strong>will</strong> be broken. Submit bug reports in <strong>#botsbotsbots</strong>{' '}
          &mdash; and <em>&ldquo;I&rsquo;m not sure what I should be clicking on&rdquo;</em> is not only
          a valid issue, it is the single most valuable piece of feedback you can send.
          <div className="tc-beta-build">{releaseLabel(build)}</div>
        </AnchoredPopup>
      )}
    </div>
  )
}
