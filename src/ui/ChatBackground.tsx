import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { MatrixClient } from 'matrix-js-sdk'
import { useAutoRefreshMedia } from '../client/useAutoRefreshMedia'
import { uploadAndPostBackground } from '../client/backgroundPost'
import type { ChatBg } from './chatBackground'

// ---------------------------------------------------------------------------
// Rendering + configuration UI for the per-room chat-window background.
// ChatBackdrop is the layer that sits behind the message list (cover-fit image
// + a readability dim). ChatBackgroundMenu is the small popover that sets it
// (upload an image -> mxc, or paste a URL) with a dim slider and Clear.
// ---------------------------------------------------------------------------

export function ChatBackdrop({ client, bg }: { client: MatrixClient; bg: ChatBg }) {
  // mxc goes through the auto-refreshing homeserver path; a raw url is used as-is
  // (best-effort -- we don't own its lifetime, so it can't self-heal).
  const mxcSrc = useAutoRefreshMedia(client, bg.mxc ?? null)
  const src = bg.mxc ? mxcSrc : bg.url ?? null
  const dim = Math.max(0, Math.min(0.9, bg.dim))

  if (!src) return null
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url("${src}")`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
      {/* Readability scrim over the image (uses the canvas color so it blends). */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'var(--cpd-color-bg-canvas-default)',
          opacity: dim,
        }}
      />
    </div>
  )
}

export function ChatBackgroundMenu({
  client,
  roomId,
  current,
  onApply,
  onClear,
  onClose,
}: {
  client: MatrixClient
  // The room the background image is POSTED to. The setting stays per-user;
  // only the bytes become a room post, which is what makes them fetchable.
  roomId: string
  current: ChatBg | undefined
  onApply: (bg: ChatBg) => void
  onClose: () => void
  onClear: () => void
}) {
  const [url, setUrl] = useState(current?.url ?? '')
  const [dim, setDim] = useState(current?.dim ?? 0.45)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const onFilePicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      // Posted for the same reason the domain background is: the gate
      // authorizes media with a message behind it. The SETTING stays local --
      // only the bytes become a room post.
      const { mxc: content_uri } = await uploadAndPostBackground(client, roomId, file, 'chat')
      onApply({ mxc: content_uri, dim })
    } catch {
      setError('Upload failed. Try again or use a URL.')
    } finally {
      setUploading(false)
    }
  }

  const applyUrl = () => {
    const v = url.trim()
    if (!v) return
    onApply({ url: v, dim })
  }

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: 'calc(100% + 6px)',
        right: 0,
        width: 268,
        zIndex: 1000,
        padding: 12,
        borderRadius: 10,
        fontFamily: 'var(--tc-ui-font, inherit)',
        color: 'var(--cpd-color-text-primary)',
        background: 'var(--cpd-color-bg-canvas-default)',
        border: '1px solid rgba(128,128,128,0.35)',
        boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Chat background</div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={(e) => void onFilePicked(e)}
        style={{ display: 'none' }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        style={btn}
      >
        {uploading ? 'Uploading…' : 'Upload image'}
      </button>

      <div style={{ fontSize: 11, color: 'var(--cpd-color-text-secondary)', margin: '10px 0 4px' }}>
        …or paste an image URL
      </div>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') applyUrl()
        }}
        placeholder="https://…"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          fontSize: 13,
          padding: '5px 7px',
          borderRadius: 6,
          color: 'var(--cpd-color-text-primary)',
          background: 'transparent',
          border: '1px solid rgba(128,128,128,0.35)',
        }}
      />

      <div style={{ fontSize: 11, color: 'var(--cpd-color-text-secondary)', margin: '10px 0 2px' }}>
        Dim for readability
      </div>
      <input
        type="range"
        min={0}
        max={0.9}
        step={0.05}
        value={dim}
        onChange={(e) => setDim(Number(e.target.value))}
        style={{ width: '100%' }}
      />

      {error && <div style={{ fontSize: 11, color: 'var(--cpd-color-text-critical-primary, #d22)', marginTop: 6 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 10 }}>
        {current && (
          <button type="button" onClick={onClear} style={{ ...btn, width: 'auto', padding: '5px 10px' }}>
            Remove
          </button>
        )}
        <button
          type="button"
          onClick={applyUrl}
          style={{
            ...btn,
            width: 'auto',
            padding: '5px 12px',
            background: 'var(--cpd-color-bg-action-primary-rest)',
            color: 'var(--cpd-color-text-on-solid-primary, #fff)',
            borderColor: 'transparent',
          }}
        >
          Apply URL
        </button>
      </div>
    </div>
  )
}

const btn: React.CSSProperties = {
  width: '100%',
  fontSize: 13,
  padding: '7px 10px',
  borderRadius: 8,
  border: '1px solid rgba(128,128,128,0.35)',
  background: 'var(--cpd-color-bg-subtle-secondary)',
  color: 'var(--cpd-color-text-primary)',
  cursor: 'pointer',
}
