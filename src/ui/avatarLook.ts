// ---------------------------------------------------------------------------
// The look of an avatar disc when there is no avatar to show.
//
// Pulled out of AvatarPill so the interaction overlay can draw the SAME disc a
// pill draws, rather than one that merely resembles it. An approach animation
// only works if the thing sliding up to somebody is recognisably you, and a
// near-copy would drift the first time either side was touched.
//
// A separate module rather than exports from the component file: a non-component
// export from a component file breaks fast refresh for the whole module
// (G-tp01). Pure, so the harness can load it (O-tp9).
// ---------------------------------------------------------------------------

// Deterministic disc colour from a user id, so a person's fallback colour is
// stable everywhere they appear and across reloads.
export function colorFor(userId: string): string {
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) % 360
  return `hsl(${h}, 55%, 45%)`
}

export function initialsFor(name: string): string {
  const cleaned = name.replace(/^[@#!]/, '').trim()
  return cleaned.slice(0, 2).toUpperCase() || '?'
}
