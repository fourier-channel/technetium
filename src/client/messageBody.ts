import DOMPurify from 'dompurify'
import type { IContent } from 'matrix-js-sdk'
import { stripReplyFallback } from './eventPreview'

// Strict allowlist matching the Matrix spec's permitted HTML subset for
// m.room.message formatted_body (org.matrix.custom.html). Anything not listed
// — scripts, event handlers, iframes, styles, forms, etc. — is stripped.
const ALLOWED_TAGS = [
  'b', 'strong', 'i', 'em', 'u', 's', 'del', 'strike',
  'a', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li',
  'p', 'br', 'hr', 'span',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'sub', 'sup', 'caption',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
]

// Only safe attributes. Notably NO style/on*; href is allowed but DOMPurify
// strips javascript:/data: URI schemes by default.
const ALLOWED_ATTR = ['href', 'title', 'alt', 'colspan', 'rowspan', 'start']

// NARROWING, not a widening. `mx-reply` is not in ALLOWED_TAGS, but DOMPurify
// unwraps a disallowed tag by default -- it drops the element and KEEPS its
// children. That is why a reply from Element renders its entire quoted
// blockquote inline here. FORBID_CONTENTS removes the subtree with the tag,
// which is what the spec's "clients SHOULD strip the fallback" means.
const FORBID_CONTENTS = ['mx-reply']

export interface RenderedBody {
  // When html is set, render via dangerouslySetInnerHTML (already sanitized).
  // Otherwise render `text` as a plain string.
  html?: string
  text?: string
}

export interface RenderOptions {
  // Set for an event that carries a real m.in_reply_to. Only then is the
  // leading "> " block treated as the spec's fallback quote -- otherwise a
  // message that legitimately opens with a blockquote would be mangled.
  isReply?: boolean
}

// Produce a safe renderable body from message content. Prefers sanitized HTML
// from formatted_body; falls back to the plaintext body.
//
// Takes CONTENT rather than an event so callers pass TimelineItem.content --
// the effective content with the winning edit already applied (S1).
export function renderMessageBody(content: IContent, opts: RenderOptions = {}): RenderedBody {
  const rawBody = typeof content.body === 'string' ? content.body : ''
  const body = opts.isReply ? stripReplyFallback(rawBody) : rawBody

  const hasHtml =
    content.format === 'org.matrix.custom.html' &&
    typeof content.formatted_body === 'string'

  if (!hasHtml) return { text: body }

  const clean = DOMPurify.sanitize(content.formatted_body as string, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_CONTENTS,
    // Force any surviving links to be safe: no javascript:, and target handling
    // is added at render time. DOMPurify already drops dangerous URI schemes.
    ALLOW_DATA_ATTR: false,
  })

  return { html: clean }
}
