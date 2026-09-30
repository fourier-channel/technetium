import type { KeyboardEvent, MouseEvent } from 'react'

// ---------------------------------------------------------------------------
// What a click on a PERSON does, everywhere a person is drawn (launch-polish
// L23).
//
// Operator, 2026-09-30: "Standardize Left vs Right click user avatars across
// the various panels. Left Click -> Perform Chat Action (where appropriate)
// Right Click -> Profile preview."
//
//   primary    left click, Enter, Space: the chat actions menu -- slap, poke,
//              hug, wave -- where the surface can perform one. Where it
//              cannot, the profile preview, so a person is never a dead click.
//   secondary  right click, the menu key, Shift+F10, and the long press a
//              phone browser reports as a context menu: the profile preview.
//
// This is the reverse of the first convention (left looked, right acted --
// AvatarPill's old comment, INTERACTIONS_PLAN IX-a), which the ruling above
// replaces. One function, so no surface can keep the old one by accident.
// ---------------------------------------------------------------------------

export type PersonOpener = ((userId: string, x: number, y: number) => void) | undefined

export interface PersonProps {
  role?: 'button'
  tabIndex?: number
  'aria-haspopup'?: 'menu' | 'dialog'
  onClick?: (e: MouseEvent<HTMLElement>) => void
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void
  onContextMenu?: (e: MouseEvent<HTMLElement>) => void
}

// Where a menu or card opens: at the pointer, or -- when the event came from
// the keyboard and carries no pointer position -- at the element's lower left.
function anchor(e: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>): [number, number] {
  if ('clientX' in e && (e.clientX !== 0 || e.clientY !== 0)) return [e.clientX, e.clientY]
  const r = e.currentTarget.getBoundingClientRect()
  return [r.left, r.bottom]
}

export function personGestures(
  userId: string,
  act: PersonOpener,
  look: PersonOpener,
  // A person drawn many times per message (read receipts) answers the pointer
  // but is not a tab stop: five per line would bury the keyboard in them, and
  // the same person is reachable by their name.
  opts: { focusable?: boolean } = {},
): PersonProps {
  const primary = act ?? look
  if (!primary) return {}
  const focusable = opts.focusable ?? true
  return {
    role: focusable ? 'button' : undefined,
    tabIndex: focusable ? 0 : undefined,
    'aria-haspopup': focusable ? (act ? 'menu' : 'dialog') : undefined,
    onClick: (e) => primary(userId, ...anchor(e)),
    onKeyDown: focusable
      ? (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          primary(userId, ...anchor(e))
        }
      : undefined,
    onContextMenu: look
      ? (e) => {
          e.preventDefault()
          look(userId, ...anchor(e))
        }
      : undefined,
  }
}
