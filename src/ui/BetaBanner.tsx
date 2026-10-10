import { useRef, useState, type PointerEvent } from 'react'
import { AnchoredPopup } from './AnchoredPopup'
import { nextNotice, type NoticeEvent, type NoticeState } from './betaNotice'

// The beta notice: a permanent strip in the shell header, no dismiss -- a notice
// that can be closed is a notice that was closed. It is ONE centred line, the
// title in amber (NEAR on the formant axis: working, not finished); the text
// behind it is a popup (hover with a mouse, tap to pin; ui/betaNotice.ts), so
// on a phone the header spends one line on it instead of four.
//
// The popup unfurls OVER the title (AnchoredPopup puts its content where its
// control was), so the instant it opens the mouse is over the popup, not the
// title. Hovering either counts, and leaving waits HOVER_GRACE_MS before it
// asks whether the pointer is over either one, or the preview would flicker
// shut and open again. A hover preview takes no focus: a mouse crossing the
// header must not pull the caret out of the composer. A pin (click, tap,
// Enter) remounts the popup with focus, for a keyboard reader.
//
// The last sentence is the operator's, nearly verbatim, because the feedback it
// invites ("I'm not sure what I should be clicking on") is the exact signal the
// onboarding-ux law runs on, and users need to be TOLD that confusion is a
// report worth sending, or they sit on it.
const HOVER_GRACE_MS = 150

export function BetaBanner() {
  const [state, setState] = useState<NoticeState>('closed')
  const title = useRef<HTMLButtonElement>(null)
  const leaving = useRef<number | undefined>(undefined)
  const send = (e: NoticeEvent) => setState((s) => nextNotice(s, e))
  const enter = (e: PointerEvent) => {
    window.clearTimeout(leaving.current)
    send({ kind: 'enter', pointerType: e.pointerType })
  }
  const leave = (e: PointerEvent) => {
    const pointerType = e.pointerType
    window.clearTimeout(leaving.current)
    leaving.current = window.setTimeout(() => {
      const still = title.current?.matches(':hover') || document.querySelector('.tc-beta-notice:hover') !== null
      if (!still) send({ kind: 'leave', pointerType })
    }, HOVER_GRACE_MS)
  }
  return (
    <div className="tc-beta-strip" role="note" aria-label="Beta notice">
      <button
        ref={title}
        type="button"
        className="tc-beta-title"
        aria-haspopup="dialog"
        aria-expanded={state !== 'closed'}
        onPointerEnter={enter}
        onPointerLeave={leave}
        onClick={() => send({ kind: 'click' })}
      >
        TECHNETIUM BETA
      </button>
      {state !== 'closed' && (
        <AnchoredPopup
          key={state}
          anchorRef={title}
          onClose={() => send({ kind: 'dismiss' })}
          label="About the beta"
          className="tc-beta-notice"
          takeFocus={state === 'pinned'}
          onPointerEnter={enter}
          onPointerLeave={leave}
        >
          Things <strong>will</strong> be broken. Submit bug reports in <strong>#botsbotsbots</strong>{' '}
          &mdash; and <em>&ldquo;I&rsquo;m not sure what I should be clicking on&rdquo;</em> is not only
          a valid issue, it is the single most valuable piece of feedback you can send.
        </AnchoredPopup>
      )}
    </div>
  )
}
