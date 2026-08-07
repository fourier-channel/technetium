import { escapeHtml } from './matrixHtml'

// ---------------------------------------------------------------------------
// W2.L3 -- composing spoilers with `||text||` or `||reason|text||`.
//
// The markers are lifted OUT of the input before markdown runs and the spans
// are put back AFTER sanitizing. That ordering is deliberate:
//
//   - before markdown, so `||` cannot be mangled by emphasis parsing and so a
//     spoiler containing markdown-ish characters does not turn into markup
//   - after sanitizing, so the span we inject is OURS. If we injected it
//     first, it would have to survive the sanitizer, which would mean allowing
//     data-mx-spoiler on the send side and letting a user hand-write one.
//
// The spoiler's contents are escaped, not parsed: a spoiler is a hidden
// literal, and supporting markdown inside one buys little and reopens the
// injection question.
// ---------------------------------------------------------------------------

// ||text||  or  ||reason|text||
//
// The reason cannot contain | or a newline, and the text is non-greedy so
// consecutive spoilers on one line stay separate.
//
// The (?!\|) on the reason's delimiter is load-bearing. Without it,
// `||one|| and ||two||` parses as reason="one", text="| and " -- the optional
// reason group happily eats the FIRST pipe of the closing `||`. Requiring the
// delimiter not to be followed by another pipe forces the group to fail and
// backtrack, so `||one||` is read as a reasonless spoiler.
const SPOILER_RE = /\|\|(?:([^|\n]*)\|(?!\|))?([\s\S]+?)\|\|/g

export interface MaskedSpoilers {
  masked: string
  spoilers: { reason: string; text: string }[]
}

// A placeholder that markdown will not touch and a user cannot type by
// accident: marked leaves it alone, and the token carries an index.
function token(i: number): string {
  return `xTCSPOILERx${i}x`
}

export function maskSpoilers(input: string): MaskedSpoilers {
  const spoilers: { reason: string; text: string }[] = []
  const masked = input.replace(SPOILER_RE, (_m, reason: string | undefined, text: string) => {
    const i = spoilers.length
    spoilers.push({ reason: reason ?? '', text })
    return token(i)
  })
  return { masked, spoilers }
}

// Put the spans back into already-sanitized HTML. Everything injected here is
// escaped by us, so this cannot introduce markup the sender controls.
export function restoreSpoilers(
  html: string,
  spoilers: { reason: string; text: string }[],
): string {
  let out = html
  for (let i = 0; i < spoilers.length; i++) {
    const { reason, text } = spoilers[i]
    const attr = reason ? ` data-mx-spoiler="${escapeHtml(reason)}"` : ' data-mx-spoiler=""'
    const span = `<span${attr}>${escapeHtml(text)}</span>`
    // Split/join rather than replace(): a `$` in the spoiler text would
    // otherwise be read as a replacement pattern.
    out = out.split(token(i)).join(span)
  }
  return out
}

// The plain-text body keeps the `||` markers. A client that does not
// understand spoilers then shows `||text||`, which readers recognise as the
// convention -- strictly better than either leaking the text bare or dropping
// it entirely.
export function hasSpoilers(input: string): boolean {
  SPOILER_RE.lastIndex = 0
  return SPOILER_RE.test(input)
}
