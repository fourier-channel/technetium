import type { IContent, MatrixEvent } from 'matrix-js-sdk'
import { buildRichReply } from './matrixHtml'

// Build the content for a reply message.
//
// m.relates_to.m.in_reply_to is what a modern client reads. The fallback
// quoting in body/formatted_body is the pre-MSC2781 form the wider ecosystem
// still renders, so a client that does not understand the relation still shows
// its reader what was being answered. Technetium strips that block back out on
// render (messageBody.ts) and shows a reply pill instead.
//
// Note the fallback forces formatted_body even for a plain-text reply: the
// quote block is HTML, so there is always formatting to send.
export function buildReplyContent(
  target: MatrixEvent,
  roomId: string,
  plain: string,
  html?: string,
): IContent {
  const fallback = buildRichReply(target, roomId, plain, html)
  return {
    msgtype: 'm.text',
    body: fallback.body,
    format: 'org.matrix.custom.html',
    formatted_body: fallback.formattedBody,
    'm.relates_to': {
      'm.in_reply_to': { event_id: target.getId() },
    },
  }
}
