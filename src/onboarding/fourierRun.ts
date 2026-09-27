// When Fourier says each bubble of a line: the timing of her run, pure so the
// check suite can hold it. The MAS sign-in pages play the same run from
// synapse-deploy mas/templates/components/fourier.html; these numbers are
// that script's, so her pace is the same on both sides of the sign-in.

/** The pause before her first bubble, once the page has settled. */
export const FIRST_BUBBLE_MS = 300

/** How long a bubble stays newest: long enough to read before the next. */
export function bubbleWait(text: string): number {
  return Math.min(1800, 450 + 16 * text.length)
}
