import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { interactionsFor, type InteractionDef } from '../client/interactionCatalog'
import { menuStep, usePopupAt, usePopupFocus } from './popupFocus'

// ---------------------------------------------------------------------------
// Right-click a person in the chat -> pick something to do to them.
//
// Two lists in one menu: things aimed AT them (only when they are not you) and
// things you do yourself. Doing a targeted interaction to yourself is filtered
// out rather than disabled -- "Slap yourself" is a joke that stops being funny
// the second time, and it would be the top entry of your own menu forever.
//
// Its first entry is the person's profile preview. A left click (or a tap)
// on a person opens this menu (L23), and the preview's own gesture is a
// right click -- which a phone may never send: iOS reports no context menu
// for a long press on a plain element. So the preview is always one entry
// away from here, on every device.
//
// Portalled to <body>, placed inside the window, and focused when it opens
// (popupFocus.ts says why each).
// ---------------------------------------------------------------------------

export function InteractionMenu({
  x,
  y,
  targetUserId,
  targetName,
  isSelf,
  disabled,
  onPick,
  onProfile,
  onClose,
}: {
  x: number
  y: number
  targetUserId: string
  targetName: string
  isSelf: boolean
  // True while the rate limit is closed, so the menu can say why rather than
  // silently doing nothing when clicked.
  disabled: boolean
  onPick: (def: InteractionDef, targetUserId: string) => void
  // Open this person's profile preview at the same place.
  onProfile?: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  usePopupAt(ref, x, y)
  usePopupFocus(ref)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const all = interactionsFor('chat')
  const targeted = isSelf ? [] : all.filter((i) => i.shape === 'targeted')
  const selfActions = all.filter((i) => i.shape === 'self')

  const row = (def: InteractionDef) => (
    <button
      key={def.id}
      type="button"
      role="menuitem"
      className="tc-ix-menu-item"
      disabled={disabled}
      onClick={() => {
        onPick(def, targetUserId)
        onClose()
      }}
    >
      <span className="tc-ix-menu-glyph" aria-hidden="true">
        {def.glyph}
      </span>
      {def.label}
    </button>
  )

  return createPortal(
    <div
      ref={ref}
      className="tc-ix-menu"
      role="menu"
      tabIndex={-1}
      aria-label={isSelf ? 'Your actions' : `Actions for ${targetName}`}
      style={{ position: 'fixed', left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])]
        const next = menuStep(e.key, items.indexOf(document.activeElement as HTMLElement), items.length)
        if (next === null) return
        e.preventDefault()
        items[next]?.focus()
      }}
    >
      {onProfile && (
        <>
          <button
            type="button"
            role="menuitem"
            className="tc-ix-menu-item"
            onClick={() => {
              onClose()
              onProfile()
            }}
          >
            <span className="tc-ix-menu-glyph" aria-hidden="true">
              {'\u{1F464}'}
            </span>
            {isSelf ? 'Your profile' : 'Profile'}
          </button>
          <div className="tc-ix-menu-sep" />
        </>
      )}
      {targeted.length > 0 && (
        <>
          <div className="tc-ix-menu-head">{targetName}</div>
          {targeted.map(row)}
          <div className="tc-ix-menu-sep" />
        </>
      )}
      <div className="tc-ix-menu-head">Yourself</div>
      {selfActions.map(row)}
      {disabled && <div className="tc-ix-menu-note">Slow down a moment...</div>}
    </div>,
    document.body,
  )
}
