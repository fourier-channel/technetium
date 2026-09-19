// The user line's sizes, read from canon rather than restated here.
//
// The four slots are laid out in CSS, but the AVATAR needs a number: AvatarDisc
// takes a pixel size because it derives its initials' font size from the disc,
// and a clip-path mask cannot be sized from a percentage. So one value has to
// cross from CSS into JS.
//
// It is READ, not copied. --mod-userline-av-* lives in formant tokens.css and
// is hydrated from fourier-basis; restating 20/24/34 in a TypeScript constant
// would make this file a second canon, and the whole reason these tokens exist
// is that the timeline said 34 and the member list said 24 with nothing
// relating them.
//
// Memoised per step, because this runs per row: getComputedStyle on the root
// forces a style resolve, and a member list is a hundred of them.
//
// FALLBACKS ARE THE TOKEN'S OWN VALUES, for the two cases where there is no
// document to ask -- a check running under node, and the first paint before
// the stylesheet has applied. If they ever disagree with canon the size is
// wrong by a few pixels, which is visible; the alternative is a zero-size
// avatar, which reads as a missing feature.
export type UserLineSize = 'sm' | 'md' | 'lg'

const FALLBACK: Record<UserLineSize, number> = { sm: 20, md: 24, lg: 34 }

const cache = new Map<UserLineSize, number>()

export function avatarPx(size: UserLineSize, scale = 1): number {
  let base = cache.get(size)
  if (base === undefined) {
    base = FALLBACK[size]
    if (typeof document !== 'undefined' && document.documentElement) {
      const raw = getComputedStyle(document.documentElement).getPropertyValue(
        `--mod-userline-av-${size}`,
      )
      const n = parseFloat(raw)
      if (Number.isFinite(n) && n > 0) base = n
    }
    cache.set(size, base)
  }
  return Math.round(base * scale)
}

// For the harness and for tests: forget what was read so a changed stylesheet
// is picked up rather than the first answer standing for the session.
export function resetUserLineSizes(): void {
  cache.clear()
}
