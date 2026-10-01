import type { KeyboardEvent, MouseEvent } from 'react'
import { userFromPermalink } from '../client/permalink'
import { SPOILER_ATTR, SPOILER_REVEALED_CLASS, toggleSpoiler } from '../client/spoilers'
import type { ProfileOpener } from './profileOpener'

// ---------------------------------------------------------------------------
// Clicks inside a formatted message (launch-polish L25), for EVERY injected
// body -- the text and a gallery's caption take these same handlers, so a
// spoiler or a link behaves the same in both (D-tc01).
//
// A message's HTML is injected, so its anchors and spoilers cannot carry React
// handlers; the body's own handlers resolve them by walking up from the event
// target.
//
//   A SPOILER not yet revealed takes the click, Enter or Space, and reveals
//   itself; a link inside it is not followed and a mention inside it does not
//   open, by left click or right, until it has been revealed.
//   A link to a PERSON (a mention) opens their profile preview, left click or
//   right -- a mention is a person, and right click on a person is the
//   preview everywhere (L23); there is no chat action in a line of text.
//   ANY OTHER link opens in a new tab, never in place of the client. That
//   means every href, not only the ones written as https://: the sanitizer
//   keeps "//host/x", "/path", "\\host" and "https:host", and the browser
//   follows each of those in this tab. So the decision is made on the
//   RESOLVED address, and a scheme that is not http(s) is not opened at all.
//
// A click with a modifier (ctrl, cmd, shift, alt) or a middle click on a
// visible link is left to the browser, which already does what those mean --
// none of them replaces this tab.
// ---------------------------------------------------------------------------

function linkIn(e: MouseEvent<HTMLElement>): HTMLAnchorElement | null {
  const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
  return a && e.currentTarget.contains(a) ? a : null
}

// The spoiler around this target that is still hidden, if any.
function hiddenSpoiler(target: EventTarget | null): Element | null {
  const el = (target as Element | null)?.closest?.(`[${SPOILER_ATTR}]`) ?? null
  return el && !el.classList.contains(SPOILER_REVEALED_CLASS) ? el : null
}

// The address when it is a web page, else null. (URL.canParse would read
// better; Safari before 17 does not have it.)
function webAddress(href: string): string | null {
  try {
    const u = new URL(href)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}

// At the pointer, or at the link when the click came from the keyboard (Enter
// on a focused link reports no pointer position).
function at(e: MouseEvent<HTMLElement>, a: Element): [number, number] {
  if (e.clientX !== 0 || e.clientY !== 0) return [e.clientX, e.clientY]
  const r = a.getBoundingClientRect()
  return [r.left, r.bottom]
}

export function onMessageBodyClick(e: MouseEvent<HTMLElement>, openProfile: ProfileOpener): void {
  if (e.defaultPrevented || e.button !== 0) return
  const spoiler = hiddenSpoiler(e.target)
  if (spoiler) {
    // The first click reveals -- a modified one too, since ctrl-click on a
    // hidden link would otherwise open it in a tab unseen.
    e.preventDefault()
    toggleSpoiler(spoiler)
    return
  }
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  const a = linkIn(e)
  if (!a) return
  e.preventDefault()
  const userId = userFromPermalink(a.getAttribute('href') ?? '')
  if (userId) {
    openProfile?.(userId, ...at(e, a))
    return
  }
  // a.href is the browser's own resolution of the attribute against this
  // page: what a default click would have navigated to.
  const url = webAddress(a.href)
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
  // Anything else -- javascript:, data:, a scheme no tab should open -- is
  // simply not followed. The sanitizer should never let one through; this is
  // the second wall, not the first.
}

export function onMessageBodyContextMenu(e: MouseEvent<HTMLElement>, openProfile: ProfileOpener): void {
  const a = linkIn(e)
  if (!a || !openProfile) return
  // Who a hidden mention names is part of what the sender hid.
  if (hiddenSpoiler(e.target)) return
  const userId = userFromPermalink(a.getAttribute('href') ?? '')
  if (!userId) return
  e.preventDefault()
  openProfile(userId, ...at(e, a))
}

// A middle click is an auxclick, not a click: on a link in a hidden spoiler it
// would open that link in a tab without revealing anything.
export function onMessageBodyAuxClick(e: MouseEvent<HTMLElement>): void {
  if (linkIn(e) && hiddenSpoiler(e.target)) e.preventDefault()
}

export function onMessageBodyKey(e: KeyboardEvent<HTMLElement>): void {
  if (e.key !== 'Enter' && e.key !== ' ') return
  const spoiler = hiddenSpoiler(e.target)
  if (spoiler) {
    e.preventDefault()
    toggleSpoiler(spoiler)
  }
}

// Spread onto an injected body: <span {...messageBodyHandlers(open)} ... />.
export function messageBodyHandlers(openProfile: ProfileOpener) {
  return {
    onClick: (e: MouseEvent<HTMLElement>) => onMessageBodyClick(e, openProfile),
    onContextMenu: (e: MouseEvent<HTMLElement>) => onMessageBodyContextMenu(e, openProfile),
    onAuxClick: onMessageBodyAuxClick,
    onKeyDown: onMessageBodyKey,
  }
}
