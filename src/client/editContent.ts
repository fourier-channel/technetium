import type { IContent, MatrixEvent } from 'matrix-js-sdk'
import { stripReplyFallback } from './eventPreview'

// Msgtypes whose body is text the user typed, and can therefore be edited in
// a text composer. An m.image's body is a filename or caption, not a draft.
const EDITABLE_MSGTYPES = ['m.text', 'm.emote', 'm.notice']

export function isEditableContent(content: IContent): boolean {
  return typeof content.msgtype === 'string' && EDITABLE_MSGTYPES.includes(content.msgtype)
}

// The text to seed the composer with when editing.
//
// Takes the EFFECTIVE content (edits already applied), so editing twice starts
// from the latest text rather than reverting to the original. The reply
// fallback is stripped: it is quoting machinery, not something the author
// typed, and leaving it in would make the author re-send a quote of a quote.
export function editableBody(content: IContent, isReply: boolean): string {
  const body = typeof content.body === 'string' ? content.body : ''
  return isReply ? stripReplyFallback(body) : body
}

// Build an m.replace per MSC2676.
//
// The top-level body is the "* new text" fallback a client that does not
// understand edits will display; m.new_content carries the real replacement.
// m.relates_to is deliberately absent from m.new_content -- an edit cannot
// retarget a reply or move a message between threads, and the original's
// relation is what survives (see relations.ts effectiveContent).
export function buildEditContent(
  target: MatrixEvent,
  current: IContent,
  plain: string,
  html?: string,
): IContent {
  const msgtype = typeof current.msgtype === 'string' ? current.msgtype : 'm.text'

  const newContent: IContent = {
    msgtype,
    body: plain,
    ...(html !== undefined ? { format: 'org.matrix.custom.html', formatted_body: html } : {}),
  }

  return {
    msgtype,
    body: `* ${plain}`,
    ...(html !== undefined
      ? { format: 'org.matrix.custom.html', formatted_body: `* ${html}` }
      : {}),
    'm.new_content': newContent,
    'm.relates_to': {
      rel_type: 'm.replace',
      event_id: target.getId(),
    },
  }
}
