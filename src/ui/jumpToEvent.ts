import { createContext, useContext } from 'react'

// ---------------------------------------------------------------------------
// Click-to-jump: reply pills (W2.1) and the pinned-message panel (W2.7) both
// need "take me to that message".
//
// The DOM search is the whole mechanism -- rows carry data-event-id, so no
// index has to be kept in sync with the timeline. When the target is not
// loaded, the provider supplied by Timeline paginates a BOUNDED number of
// pages and retries; an unbounded search would walk a busy room back to its
// creation on a mistyped id.
// ---------------------------------------------------------------------------

// How long the jumped-to row stays highlighted.
const FLASH_MS = 1200

export function scrollToEventInDom(eventId: string): boolean {
  if (typeof document === 'undefined') return false
  // CSS.escape guards ids containing quotes or brackets.
  const selector = `[data-event-id="${CSS.escape(eventId)}"]`
  const el = document.querySelector(selector)
  if (!el) return false
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  el.classList.add('tc-row-flash')
  window.setTimeout(() => el.classList.remove('tc-row-flash'), FLASH_MS)
  return true
}

export interface JumpApi {
  // Resolves true when the event was found and scrolled to.
  jump: (eventId: string) => Promise<boolean>
  // False while no deeper history can be loaded, so a pill can present itself
  // as inert rather than promising a jump it cannot make.
  canPaginate: boolean
}

// Default: DOM-only. Correct for the thread panel, which paginates its whole
// thread to exhaustion on open.
const DOM_ONLY: JumpApi = {
  jump: async (eventId: string) => scrollToEventInDom(eventId),
  canPaginate: false,
}

export const JumpContext = createContext<JumpApi>(DOM_ONLY)

export function useJump(): JumpApi {
  return useContext(JumpContext)
}
