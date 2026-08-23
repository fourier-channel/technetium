// ---------------------------------------------------------------------------
// Decorations around a display name, and the guild tag beneath it.
//
// WIRING POINT, deliberately empty. The layout reserves the slots now so that
// whatever eventually fills them -- account data, a room state event, a guild
// registry -- changes one function rather than the row renderer.
//
// THE SPACING RULE, which is the whole reason this is a separate module:
// prefix and suffix are concatenated RAW. Nothing here adds a separator, ever.
// A caller who wants "Mr. Maple, if you please." out of "Maple" supplies
// "Mr. " and ", if you please." -- leading and trailing whitespace included by
// them, on purpose. That is what makes a possessive, a comma or a bracket
// possible at all; a helpfully-inserted space would make every one of those
// wrong and there would be no way to opt out of it.
//
// Pure, so the harness can load it (O-tp9).
// ---------------------------------------------------------------------------

export interface DisplayDecoration {
  // Concatenated before the display name, verbatim.
  prefix: string
  // Concatenated after the display name, verbatim.
  suffix: string
  // Rendered centred beneath the name. Absent means the line is not drawn at
  // all rather than drawn empty -- an empty tag row on every lead message
  // would be a band of dead space down the whole timeline.
  guild: string | null
}

const NONE: DisplayDecoration = { prefix: '', suffix: '', guild: null }

// Empty, and the lookup is real rather than a stub returning a constant: this
// is the shape whatever fills it will take, so wiring a source means populating
// this map (or replacing it with a hook that reads one), not rewriting callers.
const DECORATIONS = new Map<string, DisplayDecoration>()

export function displayDecoration(userId: string): DisplayDecoration {
  return DECORATIONS.get(userId) ?? NONE
}

// The rendered name. Exists as a function so the no-added-spaces rule is one
// assertable thing rather than a JSX expression nobody can test.
export function decoratedName(name: string, dec: DisplayDecoration): string {
  return dec.prefix + name + dec.suffix
}
