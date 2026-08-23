import { ARRIVAL_ANIMATIONS, pick } from './memberEvents'

// ---------------------------------------------------------------------------
// Faces: type one into a message and it appears over your avatar for a moment.
//
// The face STAYS in the message. This is not a substitution -- ":3" is still
// what you said, and somebody on another client reads exactly that. The flash
// is decoration on top of a message that already makes sense without it.
//
// MATCHED AS A WHOLE TOKEN, whitespace or the ends of the message on either
// side. That rule is doing real work: ":3" appears inside "12:30" and inside
// "http://host:3000", and a substring match would set off a face every time
// somebody mentioned a time or a port. The cost is that ":3!" does not match --
// an honest limit, and the safer side of the trade.
//
// CASE-SENSITIVE, necessarily: "o_O" and "O_o" are two different faces, and
// folding case would collapse them into one.
//
// `art` is the hook for images. Today every face renders its own literal text,
// which is why the tokens read fine in the message too. When a face gets a
// picture, its `art` becomes an mxc and only the renderer's branch changes.
//
// Pure, so the harness can load it (O-tp9).
// ---------------------------------------------------------------------------

export interface FaceDef {
  id: string
  /** Exactly what has to be typed. */
  token: string
  /** For screen readers, since the token itself does not read aloud usefully. */
  label: string
  /** An mxc for a drawn face, when there is one. Null means render the token. */
  art: string | null
}

export const FACES: readonly FaceDef[] = [
  { id: 'cat', token: ':3', label: 'cat face', art: null },
  { id: 'blank', token: '._.', label: 'blank stare', art: null },
  { id: 'confused-left', token: 'o_O', label: 'confused', art: null },
  { id: 'confused-right', token: 'O_o', label: 'confused', art: null },
  { id: 'unimpressed', token: '-_-', label: 'unimpressed', art: null },
  { id: 'surprise', token: ':o', label: 'surprised', art: null },
  { id: 'flat', token: '-.-', label: 'unamused', art: null },
]

const BY_TOKEN = new Map(FACES.map((f) => [f.token, f]))

export function faceByToken(token: string): FaceDef | null {
  return BY_TOKEN.get(token) ?? null
}

// The FIRST face in the message wins. One flash per message either way, and
// first-wins is the rule a reader can predict without being told.
export function detectFace(body: string): FaceDef | null {
  if (!body) return null
  for (const token of body.split(/\s+/)) {
    const face = BY_TOKEN.get(token)
    if (face) return face
  }
  return null
}

// Enter and exit are drawn from the arrival vocabulary -- the same six names the
// joins use -- but seeded from the EVENT rather than randomised per render, for
// the reason the arrivals already record: a fresh pick each replay makes one row
// look like a different event every time it scrolls past, which reads as a
// rendering glitch rather than as character. It also means everyone in the room
// watches the same face arrive the same way.
//
// Distinct salts, so a face does not always leave the way it came.
export function faceEnter(seed: string): string {
  return pick(ARRIVAL_ANIMATIONS, seed, 3)
}

export function faceExit(seed: string): string {
  return pick(ARRIVAL_ANIMATIONS, seed, 11)
}
