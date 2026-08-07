import type { IContent } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// W2.8 -- build the content for a forwarded message.
//
// A forward is a NEW message that happens to carry the same payload, not a
// copy of the event. So every field that ties the original to its context has
// to come off, or the new message arrives in the target room claiming
// relationships that do not exist there.
// ---------------------------------------------------------------------------

// Fields that describe the original's PLACE rather than its content.
const STRIPPED_KEYS = [
  // Relations: a reply to an event in another room, a thread that does not
  // exist here, an edit of a message nobody here can see.
  'm.relates_to',
  'm.new_content',
  // Intentional mentions: forwarding must not ping people who were mentioned
  // in a conversation they were part of somewhere else.
  'm.mentions',
  // Our own batch hint -- a forwarded image is not part of the original
  // gallery, and carrying the id would make it try to re-join that grid.
  'net.41chan.gallery',
  // Domain time-to-depop belongs to the domain it was posted in.
  'net.41chan.domain_ttd',
]

export function buildForwardContent(content: IContent): IContent {
  const out: IContent = { ...content }
  for (const key of STRIPPED_KEYS) delete out[key]

  // The plain body of a reply carries the "> <@user> ..." fallback quote. In a
  // room where that original does not exist it is noise at best, so the
  // rendered body is rebuilt from m.new_content-free content and the fallback
  // is dropped.
  if (typeof out.body === 'string') {
    out.body = out.body.replace(/^(>[^\n]*\n)+\n?/, '')
  }
  if (typeof out.formatted_body === 'string') {
    out.formatted_body = out.formatted_body.replace(/<mx-reply>[\s\S]*?<\/mx-reply>/gi, '')
  }

  return out
}

// Images forward by MXC REFERENCE -- the same content URI is simply named
// again. No re-upload, so no second copy on the homeserver and no new booru
// post from the bridge. True for any msgtype carrying a `url`.
export function isForwardable(content: IContent): boolean {
  if (typeof content.msgtype !== 'string') return false
  // Everything with a body or a url can be re-sent. Nothing else is a message
  // a person would recognise as forwardable.
  return typeof content.body === 'string' || typeof content.url === 'string'
}
