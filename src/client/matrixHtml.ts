import type { MatrixEvent } from 'matrix-js-sdk'
import { stripReplyFallback } from './eventPreview'

// Pure HTML / matrix.to helpers. No DOM, no sdk values -- so these are
// runnable under `npm run check`.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function matrixToUser(userId: string): string {
  return `https://matrix.to/#/${encodeURIComponent(userId)}`
}

export function matrixToEvent(roomId: string, eventId: string): string {
  return `https://matrix.to/#/${encodeURIComponent(roomId)}/${encodeURIComponent(eventId)}`
}

// Remove an <mx-reply>...</mx-reply> wrapper and everything inside it.
//
// Used when quoting a message that is itself a reply: the spec says to quote
// the original WITHOUT its own fallback, otherwise every reply in a chain
// carries the entire chain's text along with it.
export function stripMxReply(html: string): string {
  return html.replace(/<mx-reply>[\s\S]*?<\/mx-reply>/gi, '')
}

export interface RichReply {
  body: string
  formattedBody: string
}

// Build the spec's rich-reply fallback (the pre-MSC2781 form Element and the
// wider ecosystem still render).
//
// The fallback is belt-and-braces: the m.relates_to is what a modern client
// reads, and Technetium itself strips this block back out on render. It is
// here so a client that does not understand m.in_reply_to still shows a reader
// what was being answered.
export function buildRichReply(
  target: MatrixEvent,
  roomId: string,
  plain: string,
  html?: string,
): RichReply {
  const sender = target.getSender() ?? ''
  const targetId = target.getId() ?? ''
  const content = target.getContent()

  // Quote the original stripped of ITS fallback, so chains do not accumulate.
  const originalPlain = stripReplyFallback(
    typeof content.body === 'string' ? content.body : '',
  )
  const quoted = originalPlain
    .split('\n')
    .map((line, i) => (i === 0 ? `> <${sender}> ${line}` : `> ${line}`))
    .join('\n')

  // The quote is always ESCAPED PLAIN TEXT, never the original's
  // formatted_body. Re-emitting another user's HTML inside our own event makes
  // us a relay for whatever they wrote, and buys nothing: this whole block is
  // fallback, and any client that renders replies natively (including this
  // one) strips it before display. Losing bold inside a quote nobody renders
  // is a fair price for not carrying someone else's markup.
  const originalHtml = escapeHtml(originalPlain)

  const newHtml = html ?? escapeHtml(plain).replace(/\n/g, '<br>')

  const formattedBody =
    `<mx-reply><blockquote>` +
    `<a href="${escapeHtml(matrixToEvent(roomId, targetId))}">In reply to</a> ` +
    `<a href="${escapeHtml(matrixToUser(sender))}">${escapeHtml(sender)}</a>` +
    `<br/>${originalHtml}` +
    `</blockquote></mx-reply>${newHtml}`

  return { body: `${quoted}\n\n${plain}`, formattedBody }
}
