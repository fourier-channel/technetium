import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useClient } from '../client/clientContextValue'
import { BOORU_ORIGIN } from '../client/booruUrl'
import { parseSession, storedSessionRaw, subscribeSession } from '../client/session'
import {
  accessTokenLine,
  booruLines,
  readBooruStatus,
  refreshTokenLine,
  type BooruRead,
  type LifeLine,
} from '../client/tokenLife'
import { AnchoredPopup } from './AnchoredPopup'
import { EncryptionOptions } from './EncryptionOptions'
import { useNowEverySecond } from './useNow'

// ---------------------------------------------------------------------------
// Manage session: a button under your name card in the room list, and the
// dropdown it opens (operator, 2026-10-05: "Build it into Technetium via a
// 'manage session' button under the user avatar in the room list. Move the
// E2EE options to that dropdown.").
//
// It holds two things. FIRST the life of every token this sign-in holds,
// counting down live -- the access token, the refresh token, and what the
// booru says of this browser's cookies there (client/tokenLife.ts says what
// each sentence claims and what it does not know). THEN encryption, moved
// here whole from Settings (EncryptionOptions.tsx).
//
// A DROPDOWN IN THE HOUSE SENSE: AnchoredPopup, portalled over the page and
// unfurling from the button, so opening it pushes nothing in the room list out
// of place (memory no-forced-reflow-law) and no panel's overflow clips it.
// The button keeps its place whether it is open or shut.
//
// What is remembered: nothing. Open or shut is a per-visit gesture, like any
// popup here -- deliberately not persisted, since a panel that reopened
// itself on every load would sit over the room list nobody asked to cover.
// ---------------------------------------------------------------------------

export function ManageSession() {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        ref={button}
        type="button"
        className="tc-pill tc-manage-session-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title="How long each of your tokens has left, and encryption"
      >
        Manage session
      </button>
      {open && (
        <AnchoredPopup anchorRef={button} onClose={() => setOpen(false)} label="Manage session" className="tc-manage-session">
          <ManageSessionBody onClose={() => setOpen(false)} />
        </AnchoredPopup>
      )}
    </>
  )
}

function ManageSessionBody({ onClose }: { onClose: () => void }) {
  return (
    <div className="tc-manage-session-body">
      <div className="tc-manage-session-head">
        <strong>Manage session</strong>
        <button type="button" className="tc-pill" onClick={onClose}>Done</button>
      </div>
      <TokenLives />
      <EncryptionOptions />
    </div>
  )
}

// The countdowns, on their own: this re-renders every second while the
// dropdown is open, and the encryption section beside it must not re-render
// with it.
function TokenLives() {
  const { client } = useClient()
  const now = useNowEverySecond()
  // The record, live: a refresh rewrites it while this is open, and the
  // countdown must follow the token actually held, not the one at open.
  const raw = useSyncExternalStore(subscribeSession, storedSessionRaw, storedSessionRaw)
  const session = parseSession(raw)
  const [booru, setBooru] = useState<BooruRead | null>(null)
  const [asked, setAsked] = useState(0)

  // Read on open and on "Read again"; never on a timer. The pass's countdown
  // runs on our clock from the one reading (tokenLife.booruLines).
  useEffect(() => {
    let cancelled = false
    // G-tc01: no synchronous setState in an effect body.
    queueMicrotask(() => {
      if (cancelled) return
      setBooru({ state: 'reading' })
      void readBooruStatus(fetch, BOORU_ORIGIN, Date.now).then((r) => {
        if (!cancelled) setBooru(r)
      })
    })
    return () => { cancelled = true }
  }, [asked])

  const lines: LifeLine[] = session
    ? [
        accessTokenLine(session.accessTokenExpiresAt, now),
        refreshTokenLine(!!session.refreshToken, session.refreshTokenIssuedAt, now),
        ...booruLines(booru, now),
      ]
    : [{ label: 'This sign-in', tone: 'bad', text: 'No session is stored in this browser any more. Log out and sign in again.' }]

  return (
    <>
      <h3 className="tc-settings-head">This sign-in</h3>
      <p className="tc-settings-note">
        {client?.getUserId() ?? session?.userId ?? 'Unknown account'}, device{' '}
        <code>{client?.getDeviceId() ?? session?.deviceId ?? 'unknown'}</code>.
      </p>
      <dl className="tc-token-life">
        {lines.map((l) => (
          <div key={l.label} className="tc-token-life-row" data-tone={l.tone}>
            <dt>{l.label}</dt>
            <dd>{l.text}</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        className="tc-pill"
        disabled={booru?.state === 'reading'}
        onClick={() => setAsked((n) => n + 1)}
      >
        {booru?.state === 'reading' ? 'Reading...' : "Read the booru's session again"}
      </button>
    </>
  )
}
