import { escapeHtml, matrixToUser } from './matrixHtml'

// ---------------------------------------------------------------------------
// W2.9 -- mention autocomplete.
//
// The composer is a plain textarea, so a picked mention lives in the draft as
// ordinary text. The mapping from that text back to a user id is remembered
// alongside, and applied at SEND time.
//
// Like spoilers, mentions are masked out BEFORE markdown and restored AFTER
// sanitizing. Doing the substitution on the finished HTML would mean searching
// for a display name inside markup, where it could match inside an href or an
// attribute and corrupt it -- a user called "test" would rewrite half the
// links in their own message.
// ---------------------------------------------------------------------------

export interface MentionTarget {
  // The literal text sitting in the draft, e.g. "@saber".
  text: string
  userId: string
}

function token(i: number): string {
  return `xTCMENTIONx${i}x`
}

export interface MaskedMentions {
  masked: string
  // Only the mentions actually still present in the text. Someone can pick a
  // mention and then delete it; sending m.mentions for a name that is no
  // longer in the message would ping them for nothing.
  used: MentionTarget[]
}

export function maskMentions(input: string, mentions: MentionTarget[]): MaskedMentions {
  let masked = input
  const used: MentionTarget[] = []
  // Longest first: with both "@sab" and "@saber" pending, masking the short
  // one first would leave a stray "er" behind.
  const ordered = [...mentions].sort((a, b) => b.text.length - a.text.length)

  for (const m of ordered) {
    if (!m.text || !masked.includes(m.text)) continue
    const i = used.length
    used.push(m)
    masked = masked.split(m.text).join(token(i))
  }
  return { masked, used }
}

// Put the matrix.to anchors back into already-sanitized HTML. Everything here
// is escaped by us, so it cannot introduce markup the sender controls.
export function restoreMentions(html: string, used: MentionTarget[]): string {
  let out = html
  for (let i = 0; i < used.length; i++) {
    const m = used[i]
    const anchor = `<a href="${escapeHtml(matrixToUser(m.userId))}">${escapeHtml(m.text)}</a>`
    // split/join, not replace(): a `$` in a display name would otherwise be
    // read as a replacement pattern.
    out = out.split(token(i)).join(anchor)
  }
  return out
}

// The `@...` fragment immediately before the caret, or null.
//
// Requires the @ to start a word, so an email address or a raw MXID typed
// mid-sentence does not open the picker on every keystroke.
export function mentionQueryAt(text: string, caret: number): { query: string; start: number } | null {
  const upto = text.slice(0, caret)
  const at = upto.lastIndexOf('@')
  if (at < 0) return null
  // Must be at the start of the input or preceded by whitespace.
  if (at > 0 && !/\s/.test(upto[at - 1])) return null
  const query = upto.slice(at + 1)
  // A space closes the query -- names are matched without them.
  if (/\s/.test(query)) return null
  return { query, start: at }
}
