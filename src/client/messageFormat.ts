import { parse, parseInline } from 'marked'
import DOMPurify from 'dompurify'
import { escapeHtml } from './matrixHtml'
import { maskSpoilers, restoreSpoilers } from './composeSpoilers'
import { maskMentions, restoreMentions, type MentionTarget } from './mentions'
import { scrubClasses } from './codeHighlight'

// Same strict allowlist as the receive-side sanitizer (messageBody.ts). marked
// passes raw HTML through by default, so we MUST sanitize its output before
// sending — a user typing literal <script> in the composer would otherwise put
// it on the wire.
const ALLOWED_TAGS = [
  'b', 'strong', 'i', 'em', 'u', 's', 'del', 'strike',
  'a', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li',
  'p', 'br', 'span',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]
const ALLOWED_ATTR = ['href', 'title']

// `class` is admitted only so marked's `language-*` on a fenced code block
// survives onto the wire. scrubClasses then deletes everything else -- a user
// CAN type literal HTML into the composer, and without this they could send
// `<span class="tc-row-actions">` and style someone else's client.
const ALLOWED_ATTR_WITH_CLASS = [...ALLOWED_ATTR, 'class']

// Vendored from DOMPurify's defaults + our own; see messageBody.ts for why
// this must be a superset (the option REPLACES the default, not extends it).
const FORBID_CONTENTS = [
  'annotation-xml', 'audio', 'colgroup', 'desc', 'foreignobject', 'head',
  'iframe', 'math', 'mi', 'mn', 'mo', 'ms', 'mtext', 'noembed', 'noframes',
  'noscript', 'plaintext', 'script', 'selectedcontent', 'style', 'svg',
  'template', 'thead', 'title', 'video', 'xmp',
  'mx-reply',
]

// A fenced block is the one construct that needs marked's BLOCK parser.
const FENCE_RE = /^```|\n```/

export interface FormattedMessage {
  // The plaintext body (always sent as `body`, the fallback for non-HTML clients).
  plain: string
  // The sanitized HTML body — set ONLY when markdown actually produced formatting.
  // When undefined, send as plain text (no pointless formatted_body).
  html?: string
  // User ids actually mentioned in the final text, for m.mentions. Only ones
  // whose text survived in the draft -- picking a mention and then deleting it
  // must not ping anyone.
  mentionedUserIds?: string[]
}

export interface FormatOptions {
  // Mentions the composer has picked, mapping draft text -> user id.
  mentions?: MentionTarget[]
}

// Convert composer input (markdown) to a Matrix message. Decides whether to send
// formatted HTML or plain text by checking if conversion actually changed anything.
export function formatMessage(input: string, opts: FormatOptions = {}): FormattedMessage {
  const plain = input.trim()
  if (!plain) return { plain }

  // Spoiler markers come out before markdown so emphasis parsing cannot chew
  // through the `||`, and go back in after sanitizing so the span is ours.
  const { masked: spoilerMasked, spoilers } = maskSpoilers(plain)

  // Mentions are masked AFTER spoilers so a mention inside a spoiler stays
  // hidden: the spoiler's contents are escaped wholesale, and a token inside
  // them would be escaped along with the rest rather than becoming a link.
  const { masked, used: mentions } = maskMentions(spoilerMasked, opts.mentions ?? [])

  // parseInline gives no wrapping <p>, which is right for a chat line -- but it
  // also means a fenced block never becomes <pre><code>. Use the block parser
  // only when there is actually a fence, so ordinary messages are unchanged.
  const fenced = FENCE_RE.test(masked)
  const raw = (
    fenced ? parse(masked, { breaks: true, async: false }) : parseInline(masked, { breaks: true })
  ) as string

  let html = DOMPurify.sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ALLOWED_ATTR_WITH_CLASS,
    FORBID_CONTENTS,
    ALLOW_DATA_ATTR: false,
  })

  // Keep only `language-*` on a <code>; drop every other class a user may have
  // hand-written as literal HTML. Without a DOM, drop class entirely.
  if (typeof document !== 'undefined') {
    const doc = document.implementation.createHTMLDocument('')
    doc.body.innerHTML = html
    scrubClasses(doc.body)
    html = doc.body.innerHTML
  } else {
    html = DOMPurify.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      FORBID_CONTENTS,
      ALLOW_DATA_ATTR: false,
    })
  }

  html = restoreMentions(html, mentions)
  html = restoreSpoilers(html, spoilers)

  const mentionedUserIds = mentions.length > 0 ? mentions.map((m) => m.userId) : undefined

  // A spoiler, a mention or a code fence IS formatting, so the plain-vs-HTML
  // comparison below would be meaningless -- the masked text never equals the
  // output.
  if (spoilers.length > 0 || mentions.length > 0 || fenced) {
    return { plain, html, mentionedUserIds }
  }

  // If sanitized HTML differs from the original text, formatting happened ->
  // send HTML. If it's identical (plus any &-escaping), it's plain -> send plain.
  // Compare against an HTML-escaped version of the plain text so that escaping
  // alone (e.g. & -> &amp;) doesn't count as "formatting".
  const escapedPlain = escapeHtml(plain).replace(/\n/g, '<br>')
  if (html === escapedPlain) return { plain }

  return { plain, html }
}
