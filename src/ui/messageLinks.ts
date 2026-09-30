import type { MouseEvent } from 'react'
import { userFromPermalink } from '../client/permalink'
import type { ProfileOpener } from './profileOpener'

// ---------------------------------------------------------------------------
// Links inside a formatted message (launch-polish L25).
//
// A message's HTML is injected, so its anchors cannot carry React handlers;
// the body's own onClick resolves them by walking up from the event target,
// as the spoiler handlers already do.
//
//   A link to a PERSON (a mention) opens their profile preview, left click or
//   right -- a mention is a person, and right click on a person is the
//   preview everywhere (L23); there is no chat action in a line of text.
//   Any other link opens in a new tab. A formatted body's anchor carries no
//   target, so a click navigated Technetium itself away -- the plaintext path
//   (linkify.tsx) always opened a new tab, and now both do.
//
// A click with a modifier (ctrl, cmd, shift, alt) or a middle click is left to
// the browser, which already does what those mean.
// ---------------------------------------------------------------------------

function linkIn(e: MouseEvent<HTMLElement>): HTMLAnchorElement | null {
  const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
  return a && e.currentTarget.contains(a) ? a : null
}

// At the pointer, or at the link when the click came from the keyboard (Enter
// on a focused link reports no pointer position).
function at(e: MouseEvent<HTMLElement>, a: Element): [number, number] {
  if (e.clientX !== 0 || e.clientY !== 0) return [e.clientX, e.clientY]
  const r = a.getBoundingClientRect()
  return [r.left, r.bottom]
}

export function onMessageLinkClick(e: MouseEvent<HTMLElement>, openProfile: ProfileOpener): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  const a = linkIn(e)
  if (!a) return
  const href = a.getAttribute('href') ?? ''
  const userId = userFromPermalink(href)
  if (userId) {
    e.preventDefault()
    openProfile?.(userId, ...at(e, a))
    return
  }
  if (/^https?:\/\//i.test(href)) {
    e.preventDefault()
    window.open(a.href, '_blank', 'noopener,noreferrer')
  }
}

export function onMessageLinkContextMenu(e: MouseEvent<HTMLElement>, openProfile: ProfileOpener): void {
  const a = linkIn(e)
  if (!a || !openProfile) return
  const userId = userFromPermalink(a.getAttribute('href') ?? '')
  if (!userId) return
  e.preventDefault()
  openProfile(userId, ...at(e, a))
}
