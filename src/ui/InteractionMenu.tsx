import { useEffect, useRef } from 'react'
import { interactionsFor, type InteractionDef } from '../client/interactionCatalog'

// ---------------------------------------------------------------------------
// Right-click a person in the chat -> pick something to do to them.
//
// Two lists in one menu: things aimed AT them (only when they are not you) and
// things you do yourself. Doing a targeted interaction to yourself is filtered
// out rather than disabled -- "Slap yourself" is a joke that stops being funny
// the second time, and it would be the top entry of your own menu forever.
// ---------------------------------------------------------------------------

export function InteractionMenu({
  x,
  y,
  targetUserId,
  targetName,
  isSelf,
  disabled,
  onPick,
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
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)

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

  return (
    <div
      ref={ref}
      className="tc-ix-menu"
      role="menu"
      style={{ position: 'fixed', left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
    >
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
    </div>
  )
}
