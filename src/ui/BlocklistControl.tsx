import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { RoomEvent, type MatrixClient } from 'matrix-js-sdk'
import {
  BlocklistRefused,
  blockedMedia,
  compileRule,
  currentBlocks,
  onBlocked,
  onBlocklistChanged,
  type Block,
  type BlocklistOp,
} from '../client/booruBlocklist'
import { editBlocklist } from '../client/useMediaTags'
import { hiddenInRoom } from '../client/hiddenInRoom'
import { BOORU_ORIGIN } from '../client/booruUrl'
import { usePopupAt, usePopupFocus } from './popupFocus'

// ---------------------------------------------------------------------------
// The person's booru blocklist, edited from Technetium (operator, approved
// 2026-11-20: "the implementation of the blocklist directly into Tc's UI ...
// then I can witness posts appearing and disappearing immediately in front
// of me, in realtime").
//
// THE BOORU'S OWN CONTROL, joined to the left of the purge/refresh rectangle
// under the name card, as on the booru (modulation navbar: the blocklist
// left of the reset rectangle; chanbooru blocklist_component). Same drawing,
// same panel, same words, so one list reads as one thing on both surfaces.
//
// ONE LIST. Every edit goes to the account (useMediaTags editBlocklist ->
// PATCH /modulation/settings) and the list the booru answers with is the one
// applied; nothing is changed here first. Applying it judges every picture
// Technetium knows again, so what the edit hides leaves the timeline and what
// it frees returns, in place. A refusal is the booru's own sentence (a locked
// block cannot be removed; it names the padlock), shown in the panel.
//
// NOT HERE (approved scope): tag autocomplete; a rule naming score, status
// or uploader is listed, marked as not applied in Technetium (booruBlocklist
// says why); a picture whose tags are not read yet matches nothing.
// ---------------------------------------------------------------------------

const BLOCK_ICON = (
  <svg className="tc-site-reset-icon" viewBox="0 0 24 24" width={16} height={16} aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M6 6l12 12" />
  </svg>
)

function useBlocks(): readonly Block[] {
  return useSyncExternalStore(onBlocklistChanged, currentBlocks)
}

function useHiddenInRoom(client: MatrixClient | null, roomId: string | null): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const recount = () => setCount(hiddenInRoom(client, roomId, blockedMedia()))
    recount()
    const stop = onBlocked(recount)
    if (!client || !roomId) return stop
    const onTimeline = (_ev: unknown, room: { roomId?: string } | undefined) => {
      if (room?.roomId === roomId) recount()
    }
    client.on(RoomEvent.Timeline, onTimeline)
    return () => {
      stop()
      client.off(RoomEvent.Timeline, onTimeline)
    }
  }, [client, roomId])
  return count
}

export function BlocklistControl({ client, roomId }: { client: MatrixClient | null; roomId: string | null }) {
  const blocks = useBlocks()
  const hidden = useHiddenInRoom(client, roomId)
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)

  const toggle = () => {
    if (at) return setAt(null)
    const r = trigger.current?.getBoundingClientRect()
    setAt(r ? { x: r.left, y: r.bottom + 6 } : { x: 8, y: 8 })
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="tc-blocklist-trigger"
        aria-haspopup="dialog"
        aria-expanded={at !== null}
        aria-label={`Blocklist: ${hidden} hidden in this room, ${blocks.length} blocks`}
        title="Blocklist: the tags hidden from you, here and on the booru"
        onClick={toggle}
        data-testid="blocklist-trigger"
      >
        {BLOCK_ICON}
        {/* The badge's room is always reserved, so a count arriving or leaving
            never moves the rectangle (no-forced-reflow). */}
        <span className={'tc-blocklist-count' + (hidden > 0 ? ' is-shown' : '')} aria-hidden="true">
          {hidden > 99 ? '99+' : hidden}
        </span>
      </button>
      {at && (
        <BlocklistPanel
          x={at.x}
          y={at.y}
          blocks={blocks}
          hidden={hidden}
          trigger={trigger}
          onClose={() => setAt(null)}
        />
      )}
    </>
  )
}

function messageOf(err: unknown): string {
  if (err instanceof BlocklistRefused) return err.message
  return err instanceof Error ? err.message : String(err)
}

function BlocklistPanel({
  x,
  y,
  blocks,
  hidden,
  trigger,
  onClose,
}: {
  x: number
  y: number
  blocks: readonly Block[]
  hidden: number
  trigger: RefObject<HTMLButtonElement | null>
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Never `disabled` while sending: disabling the focused input drops focus
  // to the page, which reads as focus leaving the panel and closes it.
  const [busy, setBusy] = useState(false)
  usePopupAt(ref, x, y)
  usePopupFocus(ref)
  useEffect(() => input.current?.focus(), [])

  // A press outside closes it, except on the trigger, whose own click toggles.
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node | null
      if (!t || ref.current?.contains(t) || trigger.current?.contains(t)) return
      onClose()
    }
    window.addEventListener('pointerdown', down, true)
    return () => window.removeEventListener('pointerdown', down, true)
  }, [onClose, trigger])

  const run = (op: BlocklistOp, rule: string, after?: () => void) => {
    setBusy(true)
    setError(null)
    editBlocklist(op, rule)
      .then(() => after?.())
      .catch((err: unknown) => setError(messageOf(err)))
      .finally(() => {
        setBusy(false)
        // The pill whose button had focus may be gone; focus must stay inside.
        if (!ref.current?.contains(document.activeElement)) input.current?.focus()
      })
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const rule = text.trim()
    if (!rule || busy) return
    run('add', rule, () => setText(''))
  }

  return createPortal(
    <div
      ref={ref}
      className="tc-blocklist-panel"
      role="dialog"
      aria-label="Your blocklist"
      aria-busy={busy}
      tabIndex={-1}
      style={{ position: 'fixed', left: x, top: y }}
      data-testid="blocklist-panel"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
      onBlur={(e) => {
        const to = e.relatedTarget as Node | null
        if (to && !ref.current?.contains(to) && !trigger.current?.contains(to)) onClose()
      }}
    >
      <div className="tc-blocklist-head">
        <h2 className="tc-blocklist-title">Blocklist</h2>
        <span className="tc-blocklist-hidden">{hidden} hidden in this room</span>
      </div>

      <form className="tc-blocklist-add" onSubmit={submit}>
        <input
          ref={input}
          type="text"
          className="tc-blocklist-input"
          aria-label="Block a tag"
          placeholder="block a tag"
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="tc-pill" aria-disabled={busy}>
          Block
        </button>
      </form>

      {error && (
        <p className="tc-blocklist-error" role="alert">
          {error}
        </p>
      )}

      {blocks.length > 0 ? (
        <ul className="tc-blocklist-pills">
          {blocks.map((b) => {
            const unseen = compileRule(b.rule).unseen.length > 0
            return (
              <li key={b.rule} className={'tc-blocklist-pill' + (b.locked ? ' is-locked' : '')}>
                <span className="tc-blocklist-pill-rule" title={b.rule}>
                  {b.rule}
                </span>
                {unseen && (
                  <span
                    className="tc-blocklist-pill-unseen"
                    title="Technetium cannot see a post's score, status or uploader, so this rule hides nothing here; the booru still applies it"
                  >
                    not applied in Tc
                  </span>
                )}
                <button
                  type="button"
                  className="tc-blocklist-pill-lock"
                  aria-pressed={b.locked}
                  aria-label={(b.locked ? 'Unlock ' : 'Lock ') + b.rule}
                  title={b.locked ? 'Locked: unlock it before it can be removed' : 'Lock it, so it cannot be removed by accident'}
                  onClick={() => !busy && run(b.locked ? 'unlock' : 'lock', b.rule)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <rect x="5" y="11" width="14" height="10" rx="2" />
                    <path d={b.locked ? 'M8 11V7a4 4 0 0 1 8 0v4' : 'M8 11V7a4 4 0 0 1 7.6-1.8'} />
                  </svg>
                </button>
                {!b.locked && (
                  <button
                    type="button"
                    className="tc-blocklist-pill-remove"
                    aria-label={'Unblock ' + b.rule}
                    title="Unblock"
                    onClick={() => !busy && run('remove', b.rule)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M7 7l10 10M17 7L7 17" />
                    </svg>
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="tc-blocklist-empty">
          Nothing blocked. Type a tag and press Enter. Tags on one line hide only posts that have all of them; start a
          tag with - to exempt it.
        </p>
      )}

      <p className="tc-blocklist-foot">
        Kept on your account, on every page.{' '}
        <a href={`${BOORU_ORIGIN}/settings#user_blacklisted_tags`} target="_blank" rel="noopener noreferrer">
          Edit as text
        </a>
      </p>
    </div>,
    document.body,
  )
}
