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

// A background's filename is chrome -- nothing reads it, and it does not
// belong in a URL parameter. The sdk builds the upload URL with
// `searchParams.set("filename", encodeURIComponent(name))`, and searchParams
// already encodes, so any name is sent DOUBLE-encoded: a space becomes %2520
// rather than %20. Names with spaces, commas or non-ASCII are the ones that
// suffer, and "ChatGPT Image Aug 7, 2026, 09_43_34 AM.png" is all three.
//
// Rather than rely on every consumer handling that correctly, backgrounds
// upload under a fixed, boring name. The original is kept in the message body
// where it is only ever text.
function safeUploadName(file: File): string {
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(file.name)?.[1]?.toLowerCase()
  return ext ? `background.${ext}` : 'background'
}

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
// Errors are tagged with the STAGE that failed. Three server round-trips hide
// behind one button, and "it failed" does not say which -- an errcode alone is
// ambiguous between an upload, a post and a state write.
export class BackgroundStageError extends Error {
  // A plain field, not a constructor parameter property: the project compiles
  // under erasableSyntaxOnly, which is also what lets checks/ run under Node.
  stage: 'upload' | 'post'

  constructor(stage: 'upload' | 'post', cause: unknown) {
    const e = cause as { errcode?: string; httpStatus?: number; message?: string }
    super(
      `background ${stage} failed` +
        (e?.httpStatus ? ` (HTTP ${e.httpStatus})` : '') +
        (e?.errcode ? ` ${e.errcode}` : '') +
        (e?.message ? `: ${e.message}` : ''),
      { cause },
    )
    this.name = 'BackgroundStageError'
    this.stage = stage
  }
}

// What one save attempt has already done on the server, so pressing Save again
// after a failure resumes instead of uploading the same bytes a second time
// (the first copy would be an orphan: media nothing references). Valid only
// for the same File, room and kind; anything else starts over.
export interface BackgroundAttempt {
  file: File
  roomId: string
  kind: BackgroundKind
  mxc?: string
  post?: BackgroundPost
}

export async function uploadAndPostBackground(
  client: MatrixClient,
  roomId: string,
  file: File,
  kind: BackgroundKind,
  // A holder the caller keeps across retries (a React ref fits). Omitted, every
  // call is a fresh attempt -- right for a picker where each try is a new file.
  attempt?: { current: BackgroundAttempt | null },
): Promise<BackgroundPost> {
  let a = attempt?.current ?? null
  if (!a || a.file !== file || a.roomId !== roomId || a.kind !== kind) {
    a = { file, roomId, kind }
    if (attempt) attempt.current = a
  }
  // Already posted on an earlier try (a later step, such as the state write,
  // is what failed): the post is the answer, and posting again would duplicate it.
  if (a.post) return a.post

  if (!a.mxc) {
    try {
      const res = await client.uploadContent(file, {
        name: safeUploadName(file),
        type: file.type,
      })
      a.mxc = res.content_uri
    } catch (err) {
      throw new BackgroundStageError('upload', err)
    }
  }
  const mxc = a.mxc

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
  try {
    const { event_id: eventId } = await client.sendMessage(
      roomId,
      null,
      content as unknown as Parameters<typeof client.sendMessage>[2],
    )
    a.post = { mxc, eventId }
    return a.post
  } catch (err) {
    throw new BackgroundStageError('post', err)
  }
}
