import DOMPurify from 'dompurify'
import type { IContent } from 'matrix-js-sdk'
import { stripReplyFallback } from './eventPreview'
import { highlightCodeBlocks, scrubClasses } from './codeHighlight'
import { prepareSpoilers, SPOILER_ATTR } from './spoilers'

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

// DOMPurify's OWN default FORBID_CONTENTS, vendored verbatim, plus mx-reply.
//
// This list must be a SUPERSET of DOMPurify's default, because passing the
// option REPLACES the default rather than extending it. W2.1 passed
// `['mx-reply']` alone and thereby silently un-forbade the contents of script,
// style, noscript, title and the rest: `<b><script>alert(1)</script></b>`
// rendered as `<b>alert(1)</b>`. Not executable -- React never re-parses it --
// but a real weakening of a defence-in-depth layer, and exactly the kind of
// accidental widening the standing law warns about.
//
// SCAN THIS ON ANY dompurify UPGRADE: if upstream adds a tag here, we must
// too. checks/sanitizer.check.ts exercises the important entries so drift
// shows up as a failure rather than as silence.
const FORBID_CONTENTS = [
  'annotation-xml', 'audio', 'colgroup', 'desc', 'foreignobject', 'head',
  'iframe', 'math', 'mi', 'mn', 'mo', 'ms', 'mtext', 'noembed', 'noframes',
  'noscript', 'plaintext', 'script', 'selectedcontent', 'style', 'svg',
  'template', 'thead', 'title', 'video', 'xmp',
  // Ours. `mx-reply` is not in ALLOWED_TAGS, but DOMPurify unwraps a
  // disallowed tag by default -- it drops the element and KEEPS its children,
  // which is why a reply from Element rendered its whole quoted blockquote
  // inline. Forbidding its contents is what the spec's "clients SHOULD strip
  // the fallback" actually requires.
  'mx-reply',
]

// `class` is allowed ONLY in the two-pass code-highlighting path, and only
// survives what scrubClasses() keeps: `language-*` on a <code>, plus the
// hljs-* classes we generate ourselves. It is NOT a general widening -- an
// attacker-supplied class on any other element is deleted between the passes.
// See codeHighlight.ts.
const ALLOWED_ATTR_WITH_CLASS = [...ALLOWED_ATTR, 'class']

// Pass 1 additionally admits the spoiler marker (W2.L2). ALLOW_DATA_ATTR stays
// FALSE -- this is one attribute by name, not the data-* family. Its value is a
// sender-supplied reason string rendered as text via CSS attr(), never markup.
const PASS1_ATTR = [...ALLOWED_ATTR_WITH_CLASS, SPOILER_ATTR]

// Pass 2 additionally admits the a11y attributes prepareSpoilers() sets. They
// are OURS: any the sender supplied were already dropped by pass 1, which does
// not list them. A sender-controlled tabindex could reorder the page's focus.
const PASS2_ATTR = [...PASS1_ATTR, 'tabindex', 'role', 'aria-expanded', 'aria-label']

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

  // Pass 1 allows `class` ONLY so a `<code class="language-js">` hint from
  // another client survives to be read. scrubClasses immediately deletes every
  // class that is not exactly that -- see codeHighlight.ts for why the order
  // matters. Without a DOM (SSR, a bare test runner) highlighting is skipped
  // and the stricter single-pass result is returned.
  const pass1 = DOMPurify.sanitize(content.formatted_body as string, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: PASS1_ATTR,
    FORBID_CONTENTS,
    // Force any surviving links to be safe: no javascript:, and target handling
    // is added at render time. DOMPurify already drops dangerous URI schemes.
    ALLOW_DATA_ATTR: false,
  })

  if (typeof document === 'undefined') {
    return { html: stripAllClasses(pass1) }
  }

  // createHTMLDocument gives an INERT document -- assigning innerHTML parses
  // without loading resources or running scripts. It is what DOMPurify itself
  // parses into, and unlike DOMParser it exists wherever `document` does.
  const doc = document.implementation.createHTMLDocument('')
  doc.body.innerHTML = pass1
  scrubClasses(doc.body)
  highlightCodeBlocks(doc.body)
  prepareSpoilers(doc.body)

  // Pass 2's input is our own output: the sender's classes are already gone,
  // and hljs emits escaped markup. Re-sanitizing anyway is defence in depth.
  const clean = DOMPurify.sanitize(doc.body.innerHTML, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: PASS2_ATTR,
    FORBID_CONTENTS,
    ALLOW_DATA_ATTR: false,
  })

  return { html: clean }
}

// Fallback for a DOM-less environment: re-sanitize without `class` at all,
// so pass 1's allowance can never reach a renderer unscrubbed.
function stripAllClasses(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_CONTENTS,
    ALLOW_DATA_ATTR: false,
  })
}
