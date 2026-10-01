import { encryptAttachment, type EncryptedFileInfo } from './encryptedFile'
import type { Thumbnail } from './imageThumbnail'
import { describeSendFailure } from './sendFailure'

// ---------------------------------------------------------------------------
// An upload that succeeded is never made twice.
//
// A picture reaches a room in two server round-trips: the bytes go to the
// media repo (which mints the mxc), then an event referencing that mxc goes to
// the room. Until 2026-10-01 a failure anywhere after the upload put the
// picture back in the tray with nothing remembered, so pressing Send again
// uploaded the SAME bytes a second time and the first copy sat in the media
// repo with no event pointing at it -- an orphan, measured on production.
// The encrypted path was worse: it uploaded the thumbnail FIRST, so a failed
// main upload orphaned the thumbnail before the picture had even gone.
//
// So every stage that reaches the server is recorded in a stash keyed by the
// pending attachment's id, the moment it succeeds, and a retry resumes from
// what is recorded: a picture whose upload landed only re-sends its event.
// The entry is dropped when the event is sent or the attachment is removed.
//
// What this CANNOT cover: an upload whose response never reached us. The
// server may hold the bytes, but we never learned the mxc, so there is nothing
// to reuse. That case is told to the user honestly instead (stage 'upload',
// see describeAttachmentFailure).
//
// Pure apart from the injected io, so the harness drives the real send order
// against fakes that fail on demand (O-tp9).
// ---------------------------------------------------------------------------

// What is known to be on the server for one pending attachment.
export interface StagedUpload {
  // Whether this was prepared for an encrypted room. A stash entry made for
  // the other answer is discarded rather than reused: reusing a plaintext
  // upload in a room that has since turned encryption on would publish it.
  encrypt: boolean
  // The picture itself. `encrypted` is the key material for EXACTLY the
  // ciphertext at `contentUri` -- it is meaningless for any other upload, which
  // is why it is stored beside the mxc rather than recomputed.
  main?: { contentUri: string; encrypted: Omit<EncryptedFileInfo, 'url'> | null }
  // The encrypted path's thumbnail fields for `info`, once settled. `{}` means
  // "settled as none" (no thumbnail could be made), so it is not retried.
  thumbInfo?: Record<string, unknown>
}

export type UploadStash = Map<string, StagedUpload>

export interface AttachmentIo {
  uploadContent(body: Blob, opts: { name: string; type: string }): Promise<{ content_uri: string }>
  makeThumbnail(file: Blob, sourceMimetype: string): Promise<Thumbnail | null>
}

// Which round-trip failed. 'upload' is the one whose lost response can leave
// bytes on the server we know nothing about.
export type AttachmentStage = 'prepare' | 'upload' | 'send'

export class AttachmentStageError extends Error {
  // A plain field, not a parameter property: erasableSyntaxOnly.
  stage: AttachmentStage

  constructor(stage: AttachmentStage, cause: unknown) {
    super(`attachment ${stage} failed`, { cause })
    this.name = 'AttachmentStageError'
    this.stage = stage
  }
}

export interface ReadyUpload {
  contentUri: string
  encrypted: Omit<EncryptedFileInfo, 'url'> | null
  thumbInfo: Record<string, unknown>
}

async function stage<T>(name: AttachmentStage, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    throw new AttachmentStageError(name, err)
  }
}

// Upload (or recall) everything one attachment needs, then send its event.
// The stash entry is written after EACH server stage succeeds and deleted only
// once `sendEvent` resolves, so any failure leaves exactly what landed.
export async function sendAttachment(args: {
  id: string
  file: File
  encrypt: boolean
  stash: UploadStash
  io: AttachmentIo
  sendEvent: (upload: ReadyUpload) => Promise<unknown>
}): Promise<void> {
  const { id, file, encrypt, stash, io, sendEvent } = args
  let entry = stash.get(id)
  if (!entry || entry.encrypt !== encrypt) {
    entry = { encrypt }
    stash.set(id, entry)
  }

  // The picture FIRST. In an encrypted room the thumbnail used to go first,
  // so a failed main upload left the thumbnail with nothing to belong to.
  if (!entry.main) {
    if (encrypt) {
      const out = await stage('prepare', async () => encryptAttachment(await file.arrayBuffer()))
      // The upload's NAME and TYPE reach the server in the clear even though
      // the bytes do not, so the real filename stays out of it. `encrypted`
      // labels these objects for a future prune (ruled 2026-09-09).
      const up = await stage('upload', () =>
        io.uploadContent(new Blob([out.ciphertext], { type: 'application/octet-stream' }), {
          name: 'encrypted',
          type: 'application/octet-stream',
        }),
      )
      entry.main = { contentUri: up.content_uri, encrypted: out.info }
    } else {
      const up = await stage('upload', () =>
        io.uploadContent(file, { name: file.name, type: file.type }),
      )
      entry.main = { contentUri: up.content_uri, encrypted: null }
    }
  }

  // The THUMBNAIL, encrypted rooms only, as a second and completely separate
  // encrypted attachment -- its own key, its own IV, its own upload. The server
  // cannot thumbnail ciphertext, so this is the only thumbnail such an image
  // can have. Failing to MAKE one is not a failure to send; the image simply
  // goes without. Failing to UPLOAD one fails the send, and the retry resumes
  // here with the picture's own upload already recorded.
  if (encrypt && !entry.thumbInfo) {
    const thumb = await io.makeThumbnail(file, file.type)
    if (thumb) {
      const tOut = await stage('prepare', async () => encryptAttachment(await thumb.blob.arrayBuffer()))
      const tUp = await stage('upload', () =>
        io.uploadContent(new Blob([tOut.ciphertext], { type: 'application/octet-stream' }), {
          name: 'encrypted-thumbnail',
          type: 'application/octet-stream',
        }),
      )
      entry.thumbInfo = {
        thumbnail_file: { ...tOut.info, url: tUp.content_uri },
        thumbnail_info: { mimetype: thumb.mimetype, size: thumb.blob.size, w: thumb.w, h: thumb.h },
      }
    } else {
      entry.thumbInfo = {}
    }
  }

  await stage('send', () =>
    sendEvent({
      contentUri: entry.main!.contentUri,
      encrypted: entry.main!.encrypted,
      thumbInfo: entry.thumbInfo ?? {},
    }),
  )
  stash.delete(id)
}

// Take one attachment out of the pending tray: revoke its preview and forget
// any upload it had, so a later pick of the same file starts clean.
export function removePendingAttachment<T extends { id: string; previewUrl: string }>(
  list: T[],
  id: string,
  stash: UploadStash,
): T[] {
  const found = list.find((a) => a.id === id)
  if (found) URL.revokeObjectURL(found.previewUrl)
  stash.delete(id)
  return list.filter((a) => a.id !== id)
}

// The user's sentence for a failed attachment send. An upload that died
// without any answer from the server (dropped connection, the sdk's own stall
// timeout, an abort) may still have landed there: say so rather than claim it
// did not reach the server. A refusal WITH an answer is the ordinary path.
export function describeAttachmentFailure(err: unknown): string {
  if (err instanceof AttachmentStageError) {
    const cause = err.cause as { errcode?: unknown; httpStatus?: unknown } | null | undefined
    const answered = typeof cause?.httpStatus === 'number' || typeof cause?.errcode === 'string'
    if (err.stage === 'upload' && !answered) {
      return 'The connection dropped before the server confirmed the upload, so it may have arrived anyway. Your picture has been kept.'
    }
    return describeSendFailure(err.cause)
  }
  return describeSendFailure(err)
}
