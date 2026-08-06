import type { MatrixEvent } from 'matrix-js-sdk'

// One-line plain-text preview of an event: the reply/edit composer banner, the
// reply pill (Wave 2), and the pinned-message list all need to show "what
// message is this about" in a single line of chrome.
//
// Deliberately NOT the rendered HTML. A banner is chrome, and injecting
// message markup into chrome is how a formatted body escapes the message area
// and starts styling the app.

// Strips the spec's mx-reply fallback -- the "> <@user:server> old text" block
// prepended to a reply's plain body. Without this, previewing a reply-to-a-reply
// shows the OLDER message instead of the one being previewed.
export function stripReplyFallback(body: string): string {
  return body.replace(/^(>[^\n]*\n)+\n?/, '')
}

export function eventPreview(ev: MatrixEvent, max = 120): string {
  if (ev.isRedacted()) return '(message deleted)'
  const content = ev.getContent()
  const body = typeof content.body === 'string' ? content.body : ''

  if (content.msgtype === 'm.image') return body ? `[image] ${body}` : '[image]'
  if (content.msgtype === 'm.file') return body ? `[file] ${body}` : '[file]'
  if (content.msgtype === 'm.video') return body ? `[video] ${body}` : '[video]'
  if (content.msgtype === 'm.audio') return body ? `[audio] ${body}` : '[audio]'

  const oneLine = stripReplyFallback(body).replace(/\s+/g, ' ').trim()
  if (oneLine.length === 0) return ev.getType()
  return oneLine.length > max ? oneLine.slice(0, max - 3) + '...' : oneLine
}
