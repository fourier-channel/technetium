import { useCallback, useSyncExternalStore } from 'react'
import { reportIgnored } from '../client/report'

// ---------------------------------------------------------------------------
// The mask an avatar is cut out with.
//
// Every shape is a clip-path in PERCENTAGES, never pixels, because the same
// disc is drawn at 26px in a member row, 40px in the timeline and larger again
// in the overlay -- a px path would only be correct at one of them.
//
// Local per-user for now, like the chat background and the tag strips (CD-21).
// See O-in6: making YOUR mask visible to OTHER people needs a shared surface,
// and Matrix has no widely-supported per-user custom profile field. Rather than
// invent one, this ships as the half that works, and other people's avatars
// stay round until that question is answered. Nothing here fakes a state: an
// unknown user's shape is the default, not a guess.
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

// Whose mask applies to whose avatar. Only your own choice is knowable today,
// so everyone else keeps the default -- stated as one pure function rather than
// scattered as `userId === me` checks through the render tree, so the day a
// shared surface exists there is exactly one place to change.
export function resolveAvatarShape(
  userId: string,
  selfId: string | null,
  selfShape: AvatarShape,
): AvatarShape {
  return selfId !== null && userId === selfId ? selfShape : DEFAULT_AVATAR_SHAPE
}

// --- preference store (localStorage, same idiom as the tag strips) ----------

const KEY = 'net.41chan.avatar_shape'

function load(): AvatarShape {
  try {
    const raw = localStorage.getItem(KEY)
    return isAvatarShape(raw) ? raw : DEFAULT_AVATAR_SHAPE
  } catch (err) {
    reportIgnored('avatar shape: read', err)
    return DEFAULT_AVATAR_SHAPE
  }
}

let current: AvatarShape = load()
const listeners = new Set<() => void>()

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function snapshot(): AvatarShape {
  return current
}

export function useAvatarShape() {
  const shape = useSyncExternalStore(subscribe, snapshot, snapshot)

  const setShape = useCallback((next: AvatarShape) => {
    if (!isAvatarShape(next)) return
    current = next
    try {
      localStorage.setItem(KEY, next)
    } catch (err) {
      reportIgnored('avatar shape: save', err)
    }
    for (const cb of listeners) cb()
  }, [])

  return { shape, setShape }
}
