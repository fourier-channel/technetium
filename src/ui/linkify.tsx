import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Turn bare URLs in PLAINTEXT message bodies into clickable links. Formatted
// (org.matrix.custom.html) bodies already carry their own <a> tags and are
// sanitized in messageBody.ts -- this is only for the plaintext fallback, where
// a raw "https://..." would otherwise render as inert text.
//
// Safety: React escapes the text nodes, and each anchor's href is taken from a
// matched http(s) URL only (or an m/www prefix we normalize to https), so no
// user text can inject markup or a javascript: scheme.
// ---------------------------------------------------------------------------

// Match http(s):// URLs and bare www. hosts. Kept deliberately conservative so
// trailing punctuation (a URL at the end of a sentence) isn't swallowed.
const URL_RE = /((?:https?:\/\/|www\.)[^\s<]+[^\s<.,!?;:'")\]}])/gi

function hrefFor(match: string): string | null {
  const url = match.startsWith('www.') ? `https://${match}` : match
  try {
    const u = new URL(url)
    if (u.protocol === 'http:' || u.protocol === 'https:') return url
  } catch {
    return null
  }
  return null
}

export function linkify(text: string): ReactNode {
  if (!text) return text
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  URL_RE.lastIndex = 0
  for (let m = URL_RE.exec(text); m !== null; m = URL_RE.exec(text)) {
    const href = hrefFor(m[0])
    if (m.index > last) out.push(text.slice(last, m.index))
    if (href) {
      out.push(
        <a key={key++} className="tc-link" href={href} target="_blank" rel="noopener noreferrer nofollow">
          {m[0]}
        </a>,
      )
    } else {
      out.push(m[0])
    }
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out.length === 1 ? out[0] : out
}
