import { reportIgnored } from '../client/report'

// ---------------------------------------------------------------------------
// The mask an avatar is cut out with.
//
// Every shape is a clip-path in PERCENTAGES, never pixels, because the same
// disc is drawn at 26px in a member row, 40px in the timeline and larger again
// in the overlay -- a px path would only be correct at one of them.
//
// WHOSE MASK APPLIES: the person's own choice, from the look in their profile
// (client/look.ts, L24), which everyone can read -- so a mask is now seen by
// everyone, not only by the person who chose it (O-in6, closed 2026-09-30).
// An unknown or unreadable choice is the default, never a guess.
// ---------------------------------------------------------------------------

export type AvatarShape = 'circle' | 'square' | 'triangle' | 'torn' | 'keyhole'

export const DEFAULT_AVATAR_SHAPE: AvatarShape = 'circle'

export interface AvatarShapeDef {
  id: AvatarShape
  label: string
  clipPath: string
}

// The keyhole's head is a circle sampled every ~30 degrees and joined to a
// tapered stem; the torn hole is a deliberately irregular ring with no two
// spans alike, because a jagged edge that repeats reads as a gear rather than
// as a tear.
export const AVATAR_SHAPES: readonly AvatarShapeDef[] = [
  { id: 'circle', label: 'Circle', clipPath: 'circle(50%)' },
  { id: 'square', label: 'Square', clipPath: 'inset(0 round 6%)' },
  { id: 'triangle', label: 'Triangle', clipPath: 'polygon(50% 3%, 97% 93%, 3% 93%)' },
  {
    id: 'torn',
    label: 'Torn hole',
    clipPath:
      'polygon(50% 2%, 62% 9%, 71% 3%, 79% 15%, 92% 17%, 87% 31%, 97% 43%, 88% 53%, 96% 67%, 83% 72%, 78% 88%, 66% 82%, 55% 97%, 44% 85%, 30% 93%, 26% 78%, 12% 72%, 21% 59%, 3% 49%, 17% 38%, 8% 27%, 23% 21%, 26% 8%, 38% 14%)',
  },
  {
    id: 'keyhole',
    label: 'Keyhole',
    clipPath:
      'polygon(34% 48%, 27% 38%, 26% 26%, 32% 15%, 42% 7%, 54% 6%, 65% 12%, 73% 22%, 74% 34%, 66% 48%, 62% 62%, 70% 99%, 30% 99%, 38% 62%)',
  },
]

const BY_ID = new Map(AVATAR_SHAPES.map((s) => [s.id, s]))

export function isAvatarShape(v: unknown): v is AvatarShape {
  return typeof v === 'string' && BY_ID.has(v as AvatarShape)
}

export function clipPathFor(shape: AvatarShape): string {
  return (BY_ID.get(shape) ?? BY_ID.get(DEFAULT_AVATAR_SHAPE))!.clipPath
}

// --- the old per-browser choice, read once to carry it over ---------------
//
// Before L24 the mask was this browser's alone, in localStorage. It is read
// (never written) so the first time the Profile panel opens, it starts from the
// shape already chosen here instead of forgetting it; saving publishes it.
const LEGACY_KEY = 'net.41chan.avatar_shape'

export function legacyAvatarShape(): AvatarShape | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    return isAvatarShape(raw) ? raw : null
  } catch (err) {
    reportIgnored('avatar shape: read the pre-profile choice', err)
    return null
  }
}
