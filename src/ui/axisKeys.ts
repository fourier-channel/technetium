// Axis navigation: the shared decision, not a shared handler.
//
// fourier-formant's grammar spec (docs/design/formant/grammar-axis-navigation.md)
// states the rule -- horizontal moves along the sequence you are browsing,
// vertical addresses the other dimension of the thing under the cursor -- and
// three obligations that implementations across the estate each got wrong
// differently:
//
//   1. A key pressed while typing belongs to the field.
//   2. Vertical calls preventDefault (it would scroll); horizontal does not
//      (it would not, and suppressing it costs a reader their cursor).
//   3. A move that cannot happen does nothing. No wrap unless the sequence
//      really is a ring.
//
// This module owns 1 and 2 only. It does NOT own the move: what "next" means
// differs per surface, and a shared mover would be an abstraction over three
// unrelated mechanics.
//
// The caller declares which axes it HANDLES, and that is load-bearing rather
// than ceremony. preventDefault belongs with the decision to consume: a
// surface with no vertical axis that suppressed up and down anyway would stop
// the page scrolling and give nothing back. The first draft of this file did
// exactly that to the thread list.

export type Axis = 'prev' | 'next' | 'up' | 'down'

const OF_KEY: Record<string, Axis> = {
  ArrowLeft: 'prev',
  ArrowRight: 'next',
  ArrowUp: 'up',
  ArrowDown: 'down',
}

/** A key event that arrived while the reader was typing into something. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el?.closest?.('input, textarea, select, [contenteditable]')
}

/**
 * Which axis move this key asks for, given the axes the caller can perform.
 *
 * Returns null for a key outside `handles`, so an unrelated Home/End/Enter
 * handler on the same element still sees an unconsumed event. Calls
 * preventDefault only for a VERTICAL move the caller will actually make.
 */
export function axisFromKey(
  e: KeyboardEvent | React.KeyboardEvent,
  handles: readonly Axis[],
): Axis | null {
  if (isTypingTarget(e.target)) return null
  const axis = OF_KEY[e.key]
  if (!axis || !handles.includes(axis)) return null
  if (axis === 'up' || axis === 'down') e.preventDefault()
  return axis
}

/** The horizontal pair, for a surface with one sequence and no second axis. */
export const HORIZONTAL: readonly Axis[] = ['prev', 'next']
/** Both axes. */
export const BOTH: readonly Axis[] = ['prev', 'next', 'up', 'down']
