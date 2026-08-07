import type { IContent, MatrixClient } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// Backgrounds are POSTED, then referenced.
//
// The fourier-auth gate authorizes booru CONTENT -- media that exists behind an
// m.image message. A background used to be uploaded and then referenced only
// from a state event, so there was no post behind it, the gate had nothing to
// authorize against, and it 403d for exactly the reason avatars do (D-bf01).
//
// Uploading and then POSTING makes the media the thing the gate already
// authorizes, rather than asking the gate to learn a new case. The permission
// model wanted falls straight out: the post lives in the room, so anyone who
// can see the room can fetch its bytes anywhere the token is accepted.
//
// The flag marks the post as chrome so surfaces can recognise it: the domain
// reads it as its background, and the timeline keeps it out of the chat log
// (it is a wallpaper, not something someone said).
// ---------------------------------------------------------------------------

export const BACKGROUND_FLAG = 'net.41chan.background'

export type BackgroundKind = 'domain' | 'chat'

export interface BackgroundPost {
  mxc: string
  eventId: string
}

export function isBackgroundPost(content: IContent): boolean {
  const flag = content[BACKGROUND_FLAG]
  return !!flag && typeof flag === 'object'
}

// Upload the file and post it as a real m.image carrying the flag.
//
// Returns both the mxc and the event id: the mxc is what gets rendered, and the
// event id is kept alongside it so the reference has provenance -- who set it,
// and which post authorizes the bytes.
export async function uploadAndPostBackground(
  client: MatrixClient,
  roomId: string,
  file: File,
  kind: BackgroundKind,
): Promise<BackgroundPost> {
  const { content_uri: mxc } = await client.uploadContent(file, {
    name: file.name,
    type: file.type,
  })

  const content: IContent = {
    msgtype: 'm.image',
    // A plain-text body is what a client that ignores the flag will show, so
    // it should read as an explanation rather than a bare filename.
    body: kind === 'domain' ? `[domain background] ${file.name}` : `[chat background] ${file.name}`,
    url: mxc,
    info: { mimetype: file.type, size: file.size },
    [BACKGROUND_FLAG]: { kind },
  }

  // threadId null: a background is not part of any conversation.
  const { event_id: eventId } = await client.sendMessage(
    roomId,
    null,
    content as unknown as Parameters<typeof client.sendMessage>[2],
  )

  return { mxc, eventId }
}
