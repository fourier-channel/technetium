import { isValidMxid } from './userDirectory'

// ---------------------------------------------------------------------------
// Which person a link in a message names, if it names one (launch-polish L25).
//
// Operator, 2026-09-30: "Currently, @ing a user just places a clickable link in
// chat to that user's 'matrix.to/' address--which seems incorrect. have it open
// that user's profile instead."
//
// A mention travels as an ordinary anchor in the formatted body -- the spec's
// form, and what Technetium itself sends (mentions.ts restoreMentions) -- so
// the only way to know a link is a PERSON is to read its address. Two shapes
// name a user:
//
//   https://matrix.to/#/@alice:example.org          (optionally ?via=...,
//   https://matrix.to/#/%40alice%3Aexample.org        and percent-encoded)
//   matrix:u/alice:example.org                       (MSC2312 URI, ?action=)
//
// Anything else -- a room, an event, a malformed id, another host that merely
// looks similar -- is not a person, and stays a link.
//
// Pure, so the harness can load it (O-tp9).
// ---------------------------------------------------------------------------

export function userFromPermalink(href: string): string | null {
  let raw: string | null = null
  const m = /^https:\/\/matrix\.to\/#\/([^?/]+)(?:[?/].*)?$/i.exec(href.trim())
  if (m) {
    try {
      raw = decodeURIComponent(m[1])
    } catch {
      // A malformed escape is not a person.
      return null
    }
  } else {
    const u = /^matrix:u\/([^?/]+)(?:\?.*)?$/i.exec(href.trim())
    if (u) {
      try {
        raw = '@' + decodeURIComponent(u[1])
      } catch {
        return null
      }
    }
  }
  if (!raw || !raw.startsWith('@')) return null
  return isValidMxid(raw) ? raw : null
}
