// Which tags are worth being pleased about.
//
// A .ts module rather than a constant inside the component, because exporting
// a non-component from a .tsx file breaks Fast Refresh -- eslint's
// react-refresh/only-export-components, which this repo enforces and which has
// caught the same shape before.
//
// The MOTION is canon: formant tokens.css defines mod-hype-move and
// mod-hype-sparkle so every surface moves identically. This file is the only
// local decision -- which NAMES wear it.
const HYPE_TAGS = new Set(['butthole'])

/**
 * Compared case-insensitively against the tag as rendered.
 *
 * Only the canonical name needs listing: the booru aliases anus -> butthole, so
 * by the time a tag reaches any client it has already been rewritten and the
 * alias never appears. If that alias is ever removed, this set is where the old
 * spelling would have to come back.
 */
export function isHypeTag(name: string): boolean {
  return HYPE_TAGS.has(name.trim().toLowerCase())
}

export { HYPE_TAGS }
