import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { IContent, MatrixClient, MatrixEvent } from 'matrix-js-sdk'
import { sendAttachment, type UploadStash } from '../client/attachmentUpload'
import { makeThumbnail } from '../client/imageThumbnail'
import { buildPictureEdit, type OldFileChoice } from '../client/pictureReplace'
import { readImageSize } from './imageSize'

// The dialog behind "Replace picture" (client/pictureReplace.ts says what a
// replacement is). Pick the new file, say what happens to the old one, send:
// the upload is the composer's own resumable one (attachmentUpload.ts), and the
// event it sends is an EDIT of the original message rather than a new one.
//
// What the creator is told is only what this client knows: the message now
// shows the new picture. Whether the booru took it is Neru-chan's to say, and
// she says it in the room.

export function ReplacePicture({
  client,
  target,
  current,
  onClose,
}: {
  client: MatrixClient
  target: MatrixEvent
  current: IContent
  onClose: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [oldFile, setOldFile] = useState<OldFileChoice>('keep')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stash = useRef<UploadStash>(new Map())
  const inputRef = useRef<HTMLInputElement | null>(null)

  const pick = (f: File | null) => {
    if (preview) URL.revokeObjectURL(preview)
    setFile(f)
    setPreview(f ? URL.createObjectURL(f) : null)
    setError(null)
  }

  const close = () => {
    if (preview) URL.revokeObjectURL(preview)
    onClose()
  }

  const send = async () => {
    const roomId = target.getRoomId()
    const eventId = target.getId()
    if (!file || !roomId || !eventId) return
    setBusy(true)
    setError(null)
    try {
      const dims = await readImageSize(file).catch(() => null)
      await sendAttachment({
        id: `replace:${eventId}`,
        file,
        encrypt: false,
        stash: stash.current,
        io: { uploadContent: (body, opts) => client.uploadContent(body, opts), makeThumbnail },
        sendEvent: (up) =>
          client.sendMessage(
            roomId,
            null,
            buildPictureEdit({
              originalId: eventId,
              current,
              url: up.contentUri,
              info: { mimetype: file.type, size: file.size, ...(dims ?? {}) },
              filename: file.name,
              oldFile,
            }) as unknown as Parameters<typeof client.sendMessage>[2],
          ),
      })
      close()
    } catch (err) {
      console.error('Picture replacement failed:', err)
      setError(
        'The new picture was not sent, so nothing changed. Fix: check the connection and press Replace again -- ' +
          'what already uploaded is reused.',
      )
      setBusy(false)
    }
  }

  return createPortal(
    <div className="tc-replace-scrim" role="dialog" aria-modal="true" aria-label="Replace picture" onClick={busy ? undefined : close}
      onKeyDown={(e) => { if (e.key === 'Escape' && !busy) close() }}>
      <div className="tc-replace" onClick={(e) => e.stopPropagation()}>
        <div className="tc-replace-title">Replace picture</div>
        <p className="tc-replace-note">
          Your message will show the new picture, and its booru post will be updated to it. The original is kept on the
          booru&apos;s record.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />
        <button type="button" className="tc-pill" disabled={busy} onClick={() => inputRef.current?.click()}>
          {file ? 'Choose a different picture' : 'Choose the new picture'}
        </button>
        {preview && <img className="tc-replace-preview" src={preview} alt="The new picture" />}
        <fieldset className="tc-replace-choice" disabled={busy}>
          <legend>The old version</legend>
          <label>
            <input type="radio" name="old-file" checked={oldFile === 'keep'} onChange={() => setOldFile('keep')} />
            Keep it
          </label>
          <label>
            <input type="radio" name="old-file" checked={oldFile === 'expire'} onChange={() => setOldFile('expire')} />
            Let it expire, then be deleted
          </label>
        </fieldset>
        {error && <p className="tc-replace-error">{error}</p>}
        <div className="tc-replace-actions">
          <button type="button" className="tc-pill" disabled={busy} onClick={close}>Cancel</button>
          <button type="button" className="tc-pill" data-primary="true" disabled={!file || busy} onClick={() => void send()}>
            {busy ? 'Replacing…' : 'Replace'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
