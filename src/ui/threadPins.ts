// ---------------------------------------------------------------------------
// Pinned threads: the ordering rule (launch-polish L4).
//
// Operator, 2026-09-24: "I need the ability to 'Pin' a thread to the list,
// that maintains its position as leftmost/first thread on the list no matter
// what sort method is chosen."
//
// So a pin is applied LAST, after whichever order produced the list -- a data
// sort, the hover freeze that holds positions still under the pointer, or the
// user's own drag-arranged order. Applied any earlier, one of those would get
// the final word: a pin made while hovering (always, since the button is on a
// card) would wait out the freeze, and a new thread in a custom order, which
// goes to the front, would land ahead of it.
//
// Several pins are an ordered list and a new pin is APPENDED, so a thread that
// is already pinned never moves when another is pinned: every pinned thread
// keeps the place it was given. With one pin that is exactly the ask.
//
// Pins are the user's, not the room's -- account data, never
// m.room.pinned_events, which is shared room state that everyone sees. And
// they are not per scope: "Here" shows this room's pinned threads first and
// simply does not have the others, because "Here" means this room.
//
// Pure, so the check suite can hold it without a DOM (O-tp9).
// ---------------------------------------------------------------------------

import { flipIdOf } from './flip'

/** A frozen empty list, so a store's snapshot is stable when nothing is pinned. */
export const NO_PINS: readonly string[] = Object.freeze([])

/**
 * The pins in stored content: NO_PINS when nothing is stored, null when what
 * is stored is not a list of non-empty strings. Malformed content is refused
 * whole rather than half-read, because a half-read list silently drops pins,
 * and the caller reports it. Duplicates keep their first position.
 */
export function parsePins(content: unknown): readonly string[] | null {
  if (content === undefined || content === null) return NO_PINS
  const pins = (content as { pins?: unknown }).pins
  if (pins === undefined) return NO_PINS
  if (!Array.isArray(pins) || !pins.every((p) => typeof p === 'string' && p.length > 0)) return null
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of pins as string[]) {
    if (seen.has(p)) continue
    seen.add(p)
    out.push(p)
  }
  return out
}

/** Pin if unpinned (appended, so earlier pins keep their places), else unpin. */
export function togglePin(pins: readonly string[], id: string): string[] {
  return pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id]
}

/**
 * Put pinned items first, in pin order; everything else keeps its order
 * exactly. Pins naming a thread that is not in the list are ignored, never
 * pruned -- the list fills in asynchronously, so "absent right now" is not
 * "gone". Returns the SAME array when no pin applies, because callers key
 * effects and memos on its identity.
 */
export function applyPins<T extends { roomId: string; rootId: string }>(
  items: T[],
  pins: readonly string[],
): T[] {
  if (pins.length === 0 || items.length === 0) return items
  const byId = new Map<string, T>()
  for (const it of items) byId.set(flipIdOf(it.roomId, it.rootId), it)
  const first: T[] = []
  const taken = new Set<string>()
  for (const id of pins) {
    const it = byId.get(id)
    if (it && !taken.has(id)) {
      first.push(it)
      taken.add(id)
    }
  }
  if (first.length === 0) return items
  // Already in place? Then nothing moved, and the identity is kept.
  if (first.every((it, i) => items[i] === it)) return items
  return [...first, ...items.filter((it) => !taken.has(flipIdOf(it.roomId, it.rootId)))]
}
