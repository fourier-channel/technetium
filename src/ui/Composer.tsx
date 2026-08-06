import {
  useState,
  useRef,
  useEffect,
  type KeyboardEvent,
  type ChangeEvent,
  type DragEvent,
} from 'react'
import type { Room } from 'matrix-js-sdk'
import { useClient } from '../client/ClientContext'
import { formatMessage } from '../client/messageFormat'
import { EmojiPicker } from './EmojiPicker'
import { useComposerMode, type ComposerMode } from './composerMode'
import { eventPreview } from '../client/eventPreview'
import { buildReplyContent } from '../client/replyContent'
import { buildEditContent, editableBody } from '../client/editContent'

type GalleryLayout = 'grid' | 'stack' | 'strip'

interface PendingAttachment {
  id: string
  file: File
  previewUrl: string
}

// Read an image file's pixel dimensions by loading it into an off-DOM <img>.
// Used to populate m.image `info.w/h` so other clients can size the thumbnail
// before downloading. Best-effort: callers treat a rejection as "no dimensions".
function readImageSize(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const dims = { w: img.naturalWidth, h: img.naturalHeight }
      URL.revokeObjectURL(url)
      resolve(dims)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('could not read image dimensions'))
    }
    img.src = url
  })
}

// Message composer pinned to the bottom of a room view. Enter sends, Shift+Enter
// inserts a newline. Markdown becomes sanitized HTML when it produces formatting,
// else plain text.
//
// Images attach (button or drop) into a pending tray — attaching no longer sends.
// On send: each image uploads to Synapse (which mints the mxc) and posts as its
// own m.image (Matrix has no album event), so bmb picks each up for the booru.
// The typed text, if any, rides along as a caption (MSC2530: filename = real name,
// body = caption) on the FIRST image. Every image in a batch also carries a dormant
// `net.41chan.gallery` hint ({id, index, count}) so a later grid renderer can
// coalesce them; clients that don't know the field just show stacked images.
export function Composer({
  room,
  threadId,
  domainTtd,
}: {
  room: Room
  threadId?: string
  // When set (composer is under an expanded domain), stamp each image with the
  // domain time-to-depop so it spawns as a canvas object for that many seconds.
  domainTtd?: number
}) {
  const { client } = useClient()
  // Reply/edit target, set by the message action bar (Wave 2). Without a
  // ComposerModeProvider above us this is permanently normal, which is exactly
  // the pre-S3 behaviour.
  const { mode, clear: clearMode } = useComposerMode()
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [layout, setLayout] = useState<GalleryLayout>('grid')
  const [sending, setSending] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  // Where to restore the caret after an emoji insert (applied post-render).
  const caretRef = useRef<number | null>(null)

  // Insert an emoji at the textarea caret (or append if unfocused), keeping the
  // picker open so several can be added; caret is restored after the re-render.
  const insertEmoji = (emoji: string) => {
    const ta = taRef.current
    const start = ta ? ta.selectionStart : text.length
    const end = ta ? ta.selectionEnd : text.length
    setText((prev) => prev.slice(0, start) + emoji + prev.slice(end))
    caretRef.current = start + emoji.length
  }

  // Restore focus + caret after an emoji insert changes the text.
  useEffect(() => {
    if (caretRef.current === null) return
    const ta = taRef.current
    const pos = caretRef.current
    caretRef.current = null
    if (ta) {
      ta.focus()
      ta.setSelectionRange(pos, pos)
    }
  }, [text])

  // Entering edit mode seeds the composer with the message's current text and
  // stashes whatever draft was there; cancelling puts the draft back, so an
  // accidental Edit does not eat what someone was typing.
  //
  // The seed lands in a microtask rather than in the effect body: a synchronous
  // setState inside an effect is what G-tc01 forbids, and this is the same
  // dodge useTimeline already uses.
  const preEditDraftRef = useRef<string | null>(null)
  useEffect(() => {
    if (mode.kind === 'edit') {
      const isReply = !!mode.content['m.relates_to']?.['m.in_reply_to']
      const seed = editableBody(mode.content, isReply)
      queueMicrotask(() => {
        setText((prev) => {
          if (preEditDraftRef.current === null) preEditDraftRef.current = prev
          return seed
        })
        caretRef.current = seed.length
      })
      return
    }
    // Left edit mode (cancelled, or the send completed and cleared it).
    const stashed = preEditDraftRef.current
    if (stashed === null) return
    preEditDraftRef.current = null
    queueMicrotask(() => setText(stashed))
  }, [mode])

  // Mirror attachments into a ref so the unmount cleanup revokes whatever is
  // still pending without re-subscribing on every change.
  const attachmentsRef = useRef<PendingAttachment[]>([])
  attachmentsRef.current = attachments
  useEffect(() => {
    return () => {
      for (const a of attachmentsRef.current) URL.revokeObjectURL(a.previewUrl)
    }
  }, [])

  const addFiles = (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith('image/'))
    if (imgs.length === 0) return
    setAttachments((prev) => [
      ...prev,
      ...imgs.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ])
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const found = prev.find((a) => a.id === id)
      if (found) URL.revokeObjectURL(found.previewUrl)
      return prev.filter((a) => a.id !== id)
    })
  }

  // Build an m.image content object, optionally captioned (MSC2530) and always
  // tagged with the batch grouping hint.
  const buildImageContent = (
    url: string,
    info: Record<string, unknown>,
    filename: string,
    caption: { plain: string; html?: string } | null,
    gallery: { id: string; index: number; count: number; layout: GalleryLayout },
  ) => {
    const captioned = !!caption && caption.plain.length > 0
    return {
      msgtype: 'm.image',
      url,
      info,
      // When captioned, body holds the caption and filename holds the real name;
      // otherwise body is the filename (plain m.image, unchanged for bmb/Element).
      body: captioned ? caption!.plain : filename,
      ...(captioned ? { filename } : {}),
      ...(captioned && caption!.html !== undefined
        ? { format: 'org.matrix.custom.html', formatted_body: caption!.html }
        : {}),
      'net.41chan.gallery': gallery,
      // Domain-mode stamp: marks this as a canvas media-object + its lifetime.
      ...(domainTtd !== undefined
        ? { 'net.41chan.domain_ttd': Math.max(1, Math.min(600, Math.round(domainTtd))) }
        : {}),
    }
  }

  const send = async () => {
    if (!client || sending) return
    const input = text.trim()
    const atts = attachments
    if (input.length === 0 && atts.length === 0) return

    setSending(true)

    // Case 1 — text only: plain message (unchanged behavior).
    if (atts.length === 0) {
      setText('') // optimistic clear; restore on failure
      try {
        const { plain, html } = formatMessage(input)
        if (mode.kind === 'edit') {
          // An edit is a NEW event relating to the original, so it is sent to
          // the room, never to the thread -- passing threadId would put an
          // m.thread relation on it and the m.replace would be ignored.
          await client.sendMessage(
            room.roomId,
            null,
            buildEditContent(mode.target, mode.content, plain, html) as unknown as Parameters<
              typeof client.sendMessage
            >[2],
          )
          clearMode()
        } else if (mode.kind === 'reply') {
          // Built by hand rather than via sendTextMessage so m.relates_to
          // rides along. sendMessage SPREADS an existing m.relates_to when it
          // adds a thread relation, and sets is_falling_back:false because we
          // supplied m.in_reply_to -- so a reply inside a thread stays a real
          // reply and does not read as the MSC3440 fallback.
          await client.sendMessage(
            room.roomId,
            threadId ?? null,
            buildReplyContent(mode.target, room.roomId, plain, html) as unknown as Parameters<
              typeof client.sendMessage
            >[2],
          )
          clearMode()
        } else if (html !== undefined) {
          if (threadId) await client.sendHtmlMessage(room.roomId, threadId, plain, html)
          else await client.sendHtmlMessage(room.roomId, plain, html)
        } else {
          if (threadId) await client.sendTextMessage(room.roomId, threadId, plain)
          else await client.sendTextMessage(room.roomId, plain)
        }
      } catch (err) {
        console.error('Send failed:', err)
        setText(input)
      } finally {
        setSending(false)
        taRef.current?.focus()
      }
      return
    }

    // Case 2 — one or more images, with the text (if any) as the caption on the
    // first. Sent sequentially; on failure we stop and keep the unsent images
    // (and the caption) so nothing is lost.
    const batchId = crypto.randomUUID()
    const caption = input.length > 0 ? formatMessage(input) : null
    setText('')
    setAttachments([])

    const remaining = [...atts]
    let failed = false
    for (let i = 0; i < atts.length; i++) {
      const att = atts[i]
      try {
        const dims = await readImageSize(att.file).catch(() => null)
        const { content_uri } = await client.uploadContent(att.file, {
          name: att.file.name,
          type: att.file.type,
        })
        const info = { mimetype: att.file.type, size: att.file.size, ...(dims ?? {}) }
        const cap =
          i === 0 && caption ? { plain: caption.plain, html: caption.html } : null
        const content = buildImageContent(content_uri, info, att.file.name, cap, {
          id: batchId,
          index: i,
          count: atts.length,
          layout,
        })
        await client.sendMessage(
          room.roomId,
          threadId ?? null,
          content as unknown as Parameters<typeof client.sendMessage>[2],
        )
        URL.revokeObjectURL(att.previewUrl)
        remaining.shift()
      } catch (err) {
        console.error('Image send failed:', err)
        failed = true
        break
      }
    }

    if (failed) {
      setAttachments(remaining) // restore unsent
      if (input.length > 0) setText(input) // restore caption
    }
    setSending(false)
    taRef.current?.focus()
  }

  const onFilePicked = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files))
    e.target.value = '' // let the same file(s) be picked again
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Esc leaves reply/edit mode. Scoped to the textarea rather than the
    // window so it cannot steal Escape from an open menu or the lightbox.
    if (e.key === 'Escape' && mode.kind !== 'normal') {
      e.preventDefault()
      clearMode()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    addFiles(Array.from(e.dataTransfer.files))
  }

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (!dragging) setDragging(true)
  }

  const canSend = !sending && (text.trim().length > 0 || attachments.length > 0)

  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={() => setDragging(false)}
      style={{
        borderTop: '1px solid rgba(128,128,128,0.25)',
        padding: '10px 16px',
        outline: dragging
          ? '2px dashed var(--cpd-color-text-action-accent, #1d8a64)'
          : 'none',
        outlineOffset: -2,
      }}
    >
      <ComposerModeBanner mode={mode} onCancel={clearMode} />

      {attachments.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--cpd-color-text-secondary)' }}>Layout:</span>
          {(['grid', 'stack', 'strip'] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setLayout(opt)}
              style={{
                fontSize: 12,
                padding: '3px 10px',
                borderRadius: 6,
                border: '1px solid var(--cpd-color-border-interactive-secondary, #444)',
                background:
                  layout === opt
                    ? 'var(--cpd-color-bg-action-primary-rest)'
                    : 'var(--cpd-color-bg-subtle-secondary)',
                color:
                  layout === opt
                    ? 'var(--cpd-color-text-on-solid-primary, #fff)'
                    : 'var(--cpd-color-text-secondary)',
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {attachments.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          {attachments.map((a) => (
            <div key={a.id} style={{ position: 'relative' }}>
              <img
                src={a.previewUrl}
                alt={a.file.name}
                style={{
                  width: 64,
                  height: 64,
                  objectFit: 'cover',
                  borderRadius: 6,
                  display: 'block',
                  border: '1px solid rgba(128,128,128,0.25)',
                }}
              />
              <button
                type="button"
                onClick={() => removeAttachment(a.id)}
                title="Remove"
                style={{
                  position: 'absolute',
                  top: -6,
                  right: -6,
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  border: 'none',
                  background: 'rgba(0,0,0,0.7)',
                  color: '#fff',
                  fontSize: 12,
                  lineHeight: '18px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          onChange={onFilePicked}
          style={{ display: 'none' }}
        />
        <div style={{ position: 'relative', flexShrink: 0 }}>
          {emojiOpen && (
            <EmojiPicker onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />
          )}
          <button
            type="button"
            onClick={() => setEmojiOpen((o) => !o)}
            disabled={sending}
            title="Emoji"
            aria-label="Insert emoji"
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--cpd-color-border-interactive-secondary, #444)',
              cursor: sending ? 'default' : 'pointer',
              background: emojiOpen
                ? 'var(--cpd-color-bg-action-primary-rest)'
                : 'var(--cpd-color-bg-subtle-secondary)',
              color: 'var(--cpd-color-text-primary)',
              fontSize: 16,
              opacity: sending ? 0.5 : 1,
            }}
          >
            😀
          </button>
        </div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={sending}
          title="Attach image"
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid var(--cpd-color-border-interactive-secondary, #444)',
            cursor: sending ? 'default' : 'pointer',
            background: 'var(--cpd-color-bg-subtle-secondary)',
            color: 'var(--cpd-color-text-primary)',
            fontSize: 16,
            opacity: sending ? 0.5 : 1,
          }}
        >
          🖼
        </button>
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            attachments.length > 0
              ? 'Add a caption (optional)…'
              : `Message ${room.name || 'this room'}`
          }
          rows={1}
          style={{
            flex: 1,
            resize: 'none',
            minHeight: 38,
            maxHeight: 160,
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid var(--cpd-color-border-interactive-secondary, #444)',
            background: 'var(--cpd-color-bg-canvas-default)',
            color: 'var(--cpd-color-text-primary)',
            fontFamily: 'inherit',
            fontSize: 14,
            lineHeight: 1.4,
          }}
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={!canSend}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: 'none',
            cursor: canSend ? 'pointer' : 'default',
            background: 'var(--cpd-color-bg-action-primary-rest)',
            color: 'var(--cpd-color-text-on-solid-primary, #fff)',
            fontWeight: 600,
            fontSize: 14,
            opacity: canSend ? 1 : 0.5,
          }}
        >
          Send
        </button>
      </div>
    </div>
  )
}

// S3 -- the reply/edit banner. Sits above the input so the target is visible
// while typing, and carries its own cancel (Esc also works from the textarea).
// Renders nothing in normal mode, so the composer is untouched until a verb
// sets a target.
function ComposerModeBanner({
  mode,
  onCancel,
}: {
  mode: ComposerMode
  onCancel: () => void
}) {
  if (mode.kind === 'normal') return null

  const isEdit = mode.kind === 'edit'
  const sender = mode.target.getSender() ?? '(unknown)'
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 8,
        padding: '6px 10px',
        borderRadius: 8,
        fontSize: 12,
        background: 'var(--cpd-color-bg-subtle-secondary)',
        // A left rule reads as "attached to something above", which is what
        // both modes mean.
        borderLeft: '3px solid var(--cpd-color-text-action-accent, #1d8a64)',
        minWidth: 0,
      }}
    >
      <span style={{ fontWeight: 600, flexShrink: 0, color: 'var(--cpd-color-text-primary)' }}>
        {isEdit ? 'Editing' : 'Replying to'}
      </span>
      {!isEdit && (
        <span style={{ flexShrink: 0, color: 'var(--cpd-color-text-secondary)' }}>{sender}</span>
      )}
      <span
        style={{
          color: 'var(--cpd-color-text-secondary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}
      >
        {eventPreview(mode.target)}
      </span>
      <button
        type="button"
        onClick={onCancel}
        title="Cancel (Esc)"
        aria-label="Cancel"
        style={{
          marginLeft: 'auto',
          flexShrink: 0,
          border: 'none',
          background: 'transparent',
          color: 'var(--cpd-color-text-secondary)',
          cursor: 'pointer',
          fontSize: 14,
          lineHeight: 1,
          padding: '2px 4px',
        }}
      >
        {'×'}
      </button>
    </div>
  )
}
