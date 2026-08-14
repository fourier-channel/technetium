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

export interface InteractionDef {
  id: string
  label: string
  // Shown in the menu. A literal glyph, not an escape -- JSX \u escapes are
  // invalid in raw text and these are functional literals under the ASCII rule.
  glyph: string
  shape: InteractionShape
  surfaces: readonly InteractionSurface[]
  // How long the animation runs. The renderer expires the instance after this,
  // so it must match the CSS or a dead node lingers.
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
    durationMs: 1100,
    phrase: '{actor} slapped {target} with an elastic sticky hand',
  },
  {
    id: 'poke',
    label: 'Poke',
    glyph: '👉',
    shape: 'targeted',
    surfaces: ['chat', 'domain'],
    durationMs: 900,
    phrase: '{actor} poked {target}',
  },
  {
    id: 'hug',
    label: 'Hug',
    glyph: '🫂',
    shape: 'targeted',
    surfaces: ['chat', 'domain'],
    durationMs: 1200,
    phrase: '{actor} hugged {target}',
  },
  {
    id: 'boop',
    label: 'Boop',
    glyph: '👆',
    shape: 'targeted',
    surfaces: ['chat', 'domain'],
    durationMs: 800,
    phrase: '{actor} booped {target}',
  },
  {
    id: 'highfive',
    label: 'High five',
    glyph: '🙏',
    shape: 'targeted',
    surfaces: ['chat', 'domain'],
    durationMs: 1000,
    phrase: '{actor} high-fived {target}',
  },
  {
    id: 'throw',
    label: 'Throw a star',
    glyph: '⭐',
    shape: 'targeted',
    surfaces: ['domain'],
    durationMs: 950,
    phrase: '{actor} threw a star at {target}',
  },

  // --- self -----------------------------------------------------------------
  {
    id: 'wave',
    label: 'Wave',
    glyph: '👋',
    shape: 'self',
    surfaces: ['chat', 'domain'],
    durationMs: 1200,
    phrase: '{actor} waved',
  },
  {
    id: 'sparkle',
    label: 'Sparkle',
    glyph: '✨',
    shape: 'self',
    surfaces: ['chat', 'domain'],
    durationMs: 1300,
    phrase: '{actor} sparkled',
  },
  {
    id: 'rip',
    label: 'RIP',
    glyph: '🪦',
    shape: 'self',
    surfaces: ['chat', 'domain'],
    durationMs: 1600,
    phrase: '{actor} did not survive that',
  },
  {
    id: 'square',
    label: 'Square',
    glyph: '⬛',
    shape: 'self',
    surfaces: ['domain'],
    durationMs: 2000,
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
