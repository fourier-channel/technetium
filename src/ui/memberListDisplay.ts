import { useCallback, useSyncExternalStore } from 'react'
import { reportIgnored } from '../client/report'
import type { PresenceState } from '../client/usePresence'

// ---------------------------------------------------------------------------
// How the user list draws itself (ui-depth-v1 U9).
//
// Two displays, and the relationship between them is the whole design:
//
//   compact  what the panel drew before this campaign -- a 26px row, a 13px
//            name, a tier glyph, a presence dot. Dense, still, and readable at
//            any length.
//   rich     the same list with the person's avatar, bigger type, room to
//            breathe, and a pulse on the honorific of anyone who is online.
//
// Rich is the default, and COMPACT IS THE LOW-ANIMATION VERSION. That is the
// operator's instruction and it is also the only arrangement that makes sense:
// the expensive parts of rich are the avatar fetch and the pulse, so "turn the
// animations down" and "draw the cheap list" are the same request. A separate
// still-but-tall display would be a third thing nobody asked for.
//
// So the toggle is a PREFERENCE and the low-animation state is an OVERRIDE.
// The panel says which is in force, because a switch that silently does
// nothing is worse than no switch: with reduced motion on, flipping to rich
// would otherwise look broken.
//
// Local per-user, like every other display preference here (CD-21): what
// somebody wants to look at is not room state. The store is the
// useSyncExternalStore idiom and NOT the `storage`-event one -- `storage` fires
// in OTHER tabs, so a settings panel could not update the list behind it.
// ---------------------------------------------------------------------------

export type MemberDensity = 'rich' | 'compact'

const KEY = 'net.41chan.member_list_display'
const DEFAULT: MemberDensity = 'rich'

// What actually gets drawn. Pure: the preference is what the user asked for,
// the answer is what the machine will honour, and the two are different things
// whenever motion is turned down.
export function effectiveDensity(pref: MemberDensity, lowAnimation: boolean): MemberDensity {
  return lowAnimation ? 'compact' : pref
}

// Is the preference currently being overridden? Drives the one line of text
// that stops the toggle reading as broken.
export function densityOverridden(pref: MemberDensity, lowAnimation: boolean): boolean {
  return effectiveDensity(pref, lowAnimation) !== pref
}

// Does this row's honorific pulse?
//
// ACTIVE means online, and only in the rich display. Three gates rather than
// one because each removes a different way this could become weather: a member
// with no rank has no glyph to pulse, a member the server has said nothing
// about is not offline and must not be drawn as either, and the compact
// display is the one that exists to be still.
export function honorificPulses(o: {
  density: MemberDensity
  presence: PresenceState | undefined
  honorific: string | null
}): boolean {
  if (o.density !== 'rich') return false
  if (!o.honorific) return false
  return o.presence === 'online'
}

export function nextDensity(d: MemberDensity): MemberDensity {
  return d === 'rich' ? 'compact' : 'rich'
}

function load(): MemberDensity {
  try {
    const raw = localStorage.getItem(KEY)
    return raw === 'rich' || raw === 'compact' ? raw : DEFAULT
  } catch (err) {
    reportIgnored('member list display: read', err)
    return DEFAULT
  }
}

let value: MemberDensity = load()
const listeners = new Set<() => void>()

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function set(next: MemberDensity): void {
  value = next
  try {
    localStorage.setItem(KEY, next)
  } catch (err) {
    reportIgnored('member list display: save', err)
  }
  for (const cb of listeners) cb()
}

export function useMemberDensity(): {
  pref: MemberDensity
  setPref: (d: MemberDensity) => void
  toggle: () => void
} {
  const pref = useSyncExternalStore(subscribe, () => value, () => DEFAULT)
  const setPref = useCallback((d: MemberDensity) => set(d), [])
  const toggle = useCallback(() => set(nextDensity(value)), [])
  return { pref, setPref, toggle }
}
