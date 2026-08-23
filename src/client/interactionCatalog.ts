// ---------------------------------------------------------------------------
// The interaction catalog -- one definition list, two surfaces.
//
// Chat interactions and domain-canvas actions are the same idea rendered in
// different places: a short, ephemeral, physical animation aimed at yourself or
// at somebody else. They keep SEPARATE transports (the domain event is deployed
// and its consumers assume canvas coordinates, so sharing a wire type would
// mean every domain client parsing chat events it cannot place), but sharing
// the DEFINITIONS is what stops the two catalogs drifting apart.
//
// Pure data plus pure helpers: no React, no matrix-js-sdk, so the harness can
// load it (O-tp9).
// ---------------------------------------------------------------------------

// 'self' plays beside the actor. 'targeted' travels from actor to target.
export type InteractionShape = 'self' | 'targeted'

// Where an interaction is allowed to be triggered from.
export type InteractionSurface = 'chat' | 'domain'

// How the chat overlay stages it. Kept in the catalog rather than switched on
// by id in the renderer, so adding an interaction is still a data change.
//
//   'self'     -- plays beside the actor, nobody else involved.
//   'travel'   -- the glyph is thrown from the actor to the target and back.
//   'approach' -- the ACTOR'S AVATAR comes to the target and acts on them there.
export type InteractionChoreo = 'self' | 'travel' | 'approach'

// Which anchors must be on screen for the play to be worth drawing.
//
// This is not cosmetic. A 'travel' play is a line between two people and is
// meaningless with one end missing, but an 'approach' play stages itself
// entirely around the TARGET -- the actor's avatar is drawn by the overlay, not
// read from their pill -- so requiring the actor to be visible would drop plays
// that would have rendered perfectly. O-in1 (drop rather than clamp) is
// unchanged; this only says which anchors O-in1 is about.
export type InteractionAnchors = 'actor' | 'target' | 'both'

export interface InteractionDef {
  id: string
  label: string
  // Shown in the menu. A literal glyph, not an escape -- JSX \u escapes are
  // invalid in raw text and these are functional literals under the ASCII rule.
  glyph: string
  shape: InteractionShape
  surfaces: readonly InteractionSurface[]
  choreo: InteractionChoreo
  anchors: InteractionAnchors
  // 'travel' only: the glyph stays ATTACHED to the actor by a stretched arm
  // that tracks it out, holds while it sticks, and reels it back. A sticky hand
  // has one; a high five is two hands meeting and a thrown star has left your
  // grip, so neither does.
  tether?: boolean
  // Aimed AT somebody with intent to land. Guard reflects these back at whoever
  // sent them; everything else is let through and merely kept at arm's length.
  // Being aimed at a person is not enough -- a hug is targeted and welcome.
  hostile?: boolean
  // How long the animation runs. The renderer expires the instance after this,
  // so it must match the CSS or a dead node lingers.
  //
  // These are deliberately UNHURRIED. The first pass was sized like a UI
  // transition -- under a second, every beat clipped by the next -- and read as
  // a flicker rather than as a thing that happened. Same correction the arrival
  // animations took (0.9-1.1s). An interaction is a small performance; it needs
  // room to wind up, land, and be seen landing.
  durationMs: number
  // Sentence shown to screen readers and in the reduced-motion fallback, with
  // {actor} and {target} substituted. Reduced motion does NOT mean "no
  // feedback" -- it means say it in words instead of moving.
  phrase: string
}

export const INTERACTIONS: readonly InteractionDef[] = [
  // --- targeted -------------------------------------------------------------
  {
    id: 'slap',
    label: 'Slap',
    glyph: '🖐',
    shape: 'targeted',
    surfaces: ['chat', 'domain'],
    choreo: 'travel',
    anchors: 'both',
    tether: true,
    hostile: true,
    // Whip out, stick for a beat, get pulled home. The stick is most of it --
    // that pause is the whole joke, and it is the first thing a short duration
    // eats.
    durationMs: 2400,
    phrase: '{actor} slapped {target} with an elastic sticky hand',
  },
  {
    id: 'poke',
    label: 'Poke',
    glyph: '👉',
    shape: 'targeted',
    surfaces: ['chat', 'domain'],
    choreo: 'approach',
    anchors: 'target',
    durationMs: 1500,
    phrase: '{actor} poked {target}',
  },
  {
    id: 'hug',
    label: 'Hug',
    glyph: '🫂',
    shape: 'targeted',
    surfaces: ['chat', 'domain'],
    choreo: 'approach',
    anchors: 'target',
    // The longest of the three: arrive, converge, hold, bounce out.
    durationMs: 2600,
    phrase: '{actor} hugged {target}',
  },
  {
    id: 'boop',
    label: 'Boop',
    glyph: '👆',
    shape: 'targeted',
    surfaces: ['chat', 'domain'],
    choreo: 'approach',
    anchors: 'target',
    durationMs: 1500,
    phrase: '{actor} booped {target}',
  },
  {
    id: 'squirt',
    label: 'Squirt',
    glyph: '💦',
    shape: 'targeted',
    surfaces: ['chat', 'domain'],
    choreo: 'travel',
    anchors: 'both',
    hostile: true,
    // Long, because the blast has to arrive, land, and be seen landing before
    // the droplets it leaves behind become the point.
    durationMs: 2200,
    phrase: '{actor} soaked {target}',
  },
  {
    id: 'highfive',
    label: 'High five',
    glyph: '🙏',
    shape: 'targeted',
    surfaces: ['chat', 'domain'],
    choreo: 'travel',
    anchors: 'both',
    durationMs: 1800,
    phrase: '{actor} high-fived {target}',
  },
  {
    id: 'throw',
    label: 'Throw a star',
    glyph: '⭐',
    shape: 'targeted',
    surfaces: ['domain'],
    choreo: 'travel',
    anchors: 'both',
    durationMs: 1600,
    phrase: '{actor} threw a star at {target}',
  },

  // --- self -----------------------------------------------------------------
  {
    id: 'wave',
    label: 'Wave',
    glyph: '👋',
    shape: 'self',
    surfaces: ['chat', 'domain'],
    choreo: 'self',
    anchors: 'actor',
    durationMs: 2000,
    phrase: '{actor} waved',
  },
  {
    id: 'sparkle',
    label: 'Sparkle',
    glyph: '✨',
    shape: 'self',
    surfaces: ['chat', 'domain'],
    choreo: 'self',
    anchors: 'actor',
    durationMs: 2100,
    phrase: '{actor} sparkled',
  },
  {
    id: 'rip',
    label: 'RIP',
    glyph: '🪦',
    shape: 'self',
    surfaces: ['chat', 'domain'],
    choreo: 'self',
    anchors: 'actor',
    durationMs: 2600,
    phrase: '{actor} did not survive that',
  },
  {
    id: 'guard',
    label: 'Guard',
    glyph: '🛡',
    shape: 'self',
    surfaces: ['chat', 'domain'],
    choreo: 'self',
    anchors: 'actor',
    durationMs: 1800,
    phrase: '{actor} put a guard up',
  },
  {
    id: 'square',
    label: 'Square',
    glyph: '⬛',
    shape: 'self',
    surfaces: ['domain'],
    choreo: 'self',
    anchors: 'actor',
    durationMs: 2800,
    phrase: '{actor} squared',
  },
]

const BY_ID = new Map(INTERACTIONS.map((i) => [i.id, i]))

export function interactionById(id: string): InteractionDef | null {
  return BY_ID.get(id) ?? null
}

export function interactionsFor(surface: InteractionSurface): InteractionDef[] {
  return INTERACTIONS.filter((i) => i.surfaces.includes(surface))
}

// The longest any interaction runs. The receiver uses this to bound how long an
// instance may sit in state, so a bad `action` value cannot leak a node.
export const MAX_INTERACTION_MS = INTERACTIONS.reduce(
  (max, i) => Math.max(max, i.durationMs),
  0,
)

export function interactionPhrase(
  def: InteractionDef,
  actor: string,
  target?: string,
): string {
  return def.phrase.replace('{actor}', actor).replace('{target}', target ?? 'someone')
}
