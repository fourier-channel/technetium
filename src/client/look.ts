import { AVATAR_SHAPES, DEFAULT_AVATAR_SHAPE, isAvatarShape, type AvatarShape } from '../ui/avatarShape'
import { seedHash } from './memberEvents'

// ---------------------------------------------------------------------------
// How a person looks, as they choose it (launch-polish L24).
//
// Operator, 2026-09-30: "Profile: Set avatar options. change avatar. mask
// shape. border/glow effect. occasional animation (like a spin or a flip, or
// sucked into a black hole. played on adding a line of text to chat, AND a
// randomized timer, not persisting forever.) Set name font, name color."
//
// WHERE IT LIVES. One small object in the person's own Matrix profile, as a
// custom profile field (MSC4133) named LOOK_FIELD: set by them, read by
// everyone, from any client or device. The homeserver advertises stable
// support (`uk.tcpip.msc4133.stable` on /versions, measured 2026-09-30), so
// this needs no server change and no new route -- it is the profile route the
// display name and the avatar already ride. The picture and the display name
// stay where they always were, in the standard profile.
//
// EVERY VALUE IS FROM A CLOSED SET. This object is written by other people
// and reaches CSS, so nothing in it is used as it arrives: each field is
// checked against its list, and an unknown or missing value is that field's
// default -- one bad field never costs the rest. Colours are NAMES from the
// list below, never a colour value, which is formant's rule (names cross a
// boundary, values do not) and keeps every name legible on the formant
// surface.
//
// Pure, so the harness can load it (O-tp9).
// ---------------------------------------------------------------------------

export const LOOK_FIELD = 'net.41chan.look'
export const LOOK_VERSION = 1

export type LookRing = 'none' | 'line' | 'glow' | 'both'
export type LookAnim = 'none' | 'spin' | 'flip' | 'blackhole'
export type LookFont = 'grotesk' | 'inter' | 'mono' | 'serif'
export type LookColor = 'green' | 'orange' | 'amber' | 'rose' | 'violet' | 'gold' | 'white'

export interface Look {
  mask: AvatarShape
  // The avatar's edge: a line that follows the mask, a glow, or both.
  ring: LookRing
  ringColor: LookColor
  // Plays when they post a line, and a few times after on a seeded timer.
  anim: LookAnim
  // Null is "the surface's own": no override at all.
  nameFont: LookFont | null
  nameColor: LookColor | null
}

export const DEFAULT_LOOK: Look = Object.freeze({
  mask: DEFAULT_AVATAR_SHAPE,
  ring: 'none',
  ringColor: 'green',
  anim: 'none',
  nameFont: null,
  nameColor: null,
}) as Look

export interface Option<T extends string> {
  id: T
  label: string
}

export const LOOK_MASKS: readonly Option<AvatarShape>[] = AVATAR_SHAPES.map((s) => ({ id: s.id, label: s.label }))

export const LOOK_RINGS: readonly Option<LookRing>[] = [
  { id: 'none', label: 'None' },
  { id: 'line', label: 'Line' },
  { id: 'glow', label: 'Glow' },
  { id: 'both', label: 'Line and glow' },
]

export const LOOK_ANIMS: readonly Option<LookAnim>[] = [
  { id: 'none', label: 'None' },
  { id: 'spin', label: 'Spin' },
  { id: 'flip', label: 'Flip' },
  { id: 'blackhole', label: 'Black hole' },
]

// Only faces the app already ships: a name drawn in a font fetched from
// somewhere else would be the viewer's browser calling a third party on the
// chooser's say-so (egress consent). Serif is the system's own.
export const LOOK_FONTS: readonly Option<LookFont>[] = [
  { id: 'grotesk', label: 'Grotesk' },
  { id: 'inter', label: 'Inter' },
  { id: 'mono', label: 'Mono' },
  { id: 'serif', label: 'Serif' },
]

export const LOOK_COLORS: readonly Option<LookColor>[] = [
  { id: 'green', label: 'Green' },
  { id: 'orange', label: 'Orange' },
  { id: 'amber', label: 'Amber' },
  { id: 'rose', label: 'Rose' },
  { id: 'violet', label: 'Violet' },
  { id: 'gold', label: 'Gold' },
  { id: 'white', label: 'White' },
]

// How long each animation plays. The stylesheet's keyframe durations are the
// same numbers, and a check holds the two equal (D-tc01): the component ends
// the play on a timer (G-tc06), so a CSS duration that drifted longer would be
// cut off and one that drifted shorter would sit finished.
export const ANIM_MS: Readonly<Record<Exclude<LookAnim, 'none'>, number>> = {
  spin: 900,
  flip: 900,
  blackhole: 1400,
}

function oneOf<T extends string>(options: readonly Option<T>[], v: unknown): T | undefined {
  return options.find((o) => o.id === v)?.id
}

// What arrived, made safe. Anything that is not an object is the default look.
export function parseLook(raw: unknown): Look {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_LOOK
  const r = raw as Record<string, unknown>
  return {
    mask: isAvatarShape(r.mask) ? r.mask : DEFAULT_LOOK.mask,
    ring: oneOf(LOOK_RINGS, r.ring) ?? DEFAULT_LOOK.ring,
    ringColor: oneOf(LOOK_COLORS, r.ringColor) ?? DEFAULT_LOOK.ringColor,
    anim: oneOf(LOOK_ANIMS, r.anim) ?? DEFAULT_LOOK.anim,
    nameFont: oneOf(LOOK_FONTS, r.nameFont) ?? null,
    nameColor: oneOf(LOOK_COLORS, r.nameColor) ?? null,
  }
}

// What is written: the fields and a version, nothing else. Plain strings --
// canonical JSON has no floats (G-bf04) and this carries none.
export function serializeLook(look: Look): Record<string, unknown> {
  const out: Record<string, unknown> = {
    v: LOOK_VERSION,
    mask: look.mask,
    ring: look.ring,
    ringColor: look.ringColor,
    anim: look.anim,
  }
  if (look.nameFont) out.nameFont = look.nameFont
  if (look.nameColor) out.nameColor = look.nameColor
  return out
}

export function sameLook(a: Look, b: Look): boolean {
  return a.mask === b.mask && a.ring === b.ring && a.ringColor === b.ringColor && a.anim === b.anim
    && a.nameFont === b.nameFont && a.nameColor === b.nameColor
}

export function isDefaultLook(look: Look): boolean {
  return sameLook(look, DEFAULT_LOOK)
}

// The attributes a NAME carries so the stylesheet can draw it. Absent means
// the surface's own font and ink -- an attribute is never set to "default".
export function nameAttrs(look: Look): { 'data-name-font'?: LookFont; 'data-name-color'?: LookColor } {
  return {
    ...(look.nameFont ? { 'data-name-font': look.nameFont } : {}),
    ...(look.nameColor ? { 'data-name-color': look.nameColor } : {}),
  }
}

// ---------------------------------------------------------------------------
// When the animation plays: on the line, then a few more times, then never.
//
// "played on adding a line of text to chat, AND a randomized timer, not
// persisting forever." A line younger than LIVE_WINDOW_MS when it appears was
// just said, so its speaker's avatar plays; then up to REPLAYS more times at
// gaps drawn from the line's own id, all inside REPLAY_WINDOW_MS, and that is
// the end of it. Seeded rather than Math.random, as every other pick in this
// client is (memberEvents.ts): everyone watching sees the same avatar move at
// the same moments, and a line scrolled past a month later plays nothing.
// ---------------------------------------------------------------------------
export const LIVE_WINDOW_MS = 30_000
export const REPLAYS = 2
export const REPLAY_GAP_MIN_MS = 20_000
export const REPLAY_GAP_MAX_MS = 75_000
export const REPLAY_WINDOW_MS = 180_000

// Offsets from the moment the line was sent, ascending, each inside the window.
export function replaySchedule(seed: string): number[] {
  const out: number[] = []
  let at = 0
  for (let i = 0; i < REPLAYS; i++) {
    const span = REPLAY_GAP_MAX_MS - REPLAY_GAP_MIN_MS
    at += REPLAY_GAP_MIN_MS + (seedHash(`${seed}:replay:${i}`) % (span + 1))
    if (at > REPLAY_WINDOW_MS) break
    out.push(at)
  }
  return out
}

// Every play still ahead for a line of this age: the arrival itself if the
// line was just said (and `arrival` has not already been played), then
// whatever of its schedule has not passed -- so somebody who opens the room a
// minute later sees the same later plays as everyone else, and a line older
// than the window plays nothing, which is how history never replays.
//
// The age is measured on THIS client's clock (the SDK's localTimestamp, which
// is arrival minus the server's own count of the event's age), never as
// now - origin_server_ts: a viewer whose clock ran behind the homeserver's saw
// every fresh line as "from the future" and never saw a look play at all. A
// negative age can then only mean the local clock stepped; the line was just
// said.
export function playsAhead(seed: string, ageMs: number, arrival = true): number[] {
  if (!Number.isFinite(ageMs)) return []
  const age = Math.max(0, ageMs)
  const later = replaySchedule(seed).map((at) => at - age).filter((d) => d > 0)
  return arrival && age <= LIVE_WINDOW_MS ? [0, ...later] : later
}

// One line's plays, remembered across its row being drawn again. A line you
// send is drawn first as a local echo; when the server confirms it, the SDK
// re-keys the SAME event in place and its row remounts -- which played the
// arrival a second time, and reseeded the later plays from the new id. The
// record keeps the first id as the seed and whether the arrival has played.
export interface LinePlays {
  seed: string
  arrived: boolean
}

export function playsFor(record: LinePlays | undefined, id: string, ageMs: number): { record: LinePlays; delays: number[] } {
  const r = record ?? { seed: id, arrived: false }
  return { record: r, delays: playsAhead(r.seed, ageMs, !r.arrived) }
}
