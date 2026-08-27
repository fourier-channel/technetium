import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useClient } from '../client/ClientContext'
import { fetchMediaSrc, parseMxc } from '../client/media'
import { MediaTags } from './MediaTags'
import { axisFromKey, isTypingTarget, BOTH } from './axisKeys'
import { flatIndex, stepImage, totalImages } from './mediaSequence'

// Full-screen image viewer, mounted once at App root as a provider so any
// descendant (timeline, thread panel) opens it via useLightbox() with no
// prop-drilling. Holds an ordered SET of images plus the current index: a
// single image is just a one-element set (no nav shown); a gallery passes its
// whole batch so prev/next steps within it. Shows the current image full-res
// (no thumbnail width), fetched through the same authed gateway path as inline
// images. Owns the object-URL lifecycle and retains the fetched blob so Save
// reuses it -- no second download.

// A single image in the viewer: the mxc to show, an optional name for the
// download filename / alt text, and an optional mimetype to derive an extension.
export interface LightboxItem {
  mxc: string
  /** The room this image was rendered from. Needed for ENCRYPTED rooms, where
   *  the server cannot see which room an mxc belongs to. */
  roomId?: string
  name?: string
  mimetype?: string
}

// The conversation the open image came from, supplying the VERTICAL axis:
// every image-bearing message in it, in timeline order, as a list of stops (a
// lone image is a one-item stop, a gallery batch is one stop of N). Built by
// the surface that rendered the messages -- see mediaSequence.ts -- because the
// viewer is mounted at App root and has no idea what the reader is reading.
export interface LightboxThread {
  stops: LightboxItem[][]
  /** Which stop the opened set is. */
  stop: number
}

interface LightboxApi {
  // Open the viewer on a set of images at startIndex (clamped). A one-element
  // set shows no horizontal navigation. Pass `thread` to give up/down a
  // conversation to walk; without it the viewer has no vertical axis.
  open: (items: LightboxItem[], startIndex?: number, thread?: LightboxThread) => void
}

const LightboxContext = createContext<LightboxApi | null>(null)

// Hook for any descendant of LightboxProvider to open the viewer.
export function useLightbox(): LightboxApi {
  const ctx = useContext(LightboxContext)
  if (!ctx) throw new Error('useLightbox must be used within a LightboxProvider')
  return ctx
}

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
}

// Build a safe download filename: prefer the message's name, else the mxc
// mediaId; strip path separators; ensure an extension, deriving one from the
// mimetype when the name carries none.
function downloadName(item: LightboxItem): string {
  const parsed = parseMxc(item.mxc)
  let base = (item.name?.trim() || parsed?.mediaId || 'image').replace(/[/\\]+/g, '_')
  if (!/\.[a-z0-9]{1,8}$/i.test(base)) {
    const ext = item.mimetype ? MIME_EXT[item.mimetype] : undefined
    if (ext) base = `${base}.${ext}`
  }
  return base
}

const toolbarBtn: React.CSSProperties = {
  fontSize: 13,
  padding: '6px 14px',
  borderRadius: 6,
  border: '1px solid var(--cpd-color-border-interactive-secondary, #444)',
  background: 'var(--cpd-color-bg-subtle-secondary)',
  color: 'var(--cpd-color-text-primary)',
  cursor: 'pointer',
}

const navBtn: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  width: 44,
  height: 64,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 28,
  lineHeight: 1,
  borderRadius: 8,
  border: '1px solid var(--cpd-color-border-interactive-secondary, #444)',
  background: 'rgba(20,20,20,0.6)',
  color: 'var(--cpd-color-text-primary)',
  cursor: 'pointer',
}

// The vertical pair. Same look, turned through ninety degrees, because they are
// the same kind of control on the other axis and should read that way.
const vertNavBtn: React.CSSProperties = {
  ...navBtn,
  top: undefined,
  left: '50%',
  transform: 'translateX(-50%)',
  width: 64,
  height: 40,
  fontSize: 20,
}

export function LightboxProvider({ children }: { children: React.ReactNode }) {
  const { client } = useClient()
  const [items, setItems] = useState<LightboxItem[] | null>(null)
  const [index, setIndex] = useState(0)
  const [thread, setThread] = useState<LightboxThread | null>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState(false)
  // The fetched full-res object URL, retained so Save reuses the exact blob the
  // viewer already downloaded. Revoked on close / item change.
  const revokeRef = useRef<(() => void) | null>(null)

  const current = items && index >= 0 && index < items.length ? items[index] : null
  const hasNav = !!items && items.length > 1
  const atFirst = index <= 0
  const atLast = !items || index >= items.length - 1

  // Where the current image sits in the whole conversation, and whether there
  // is anywhere to go on that axis. Counted in IMAGES, not messages: "next" on
  // the vertical means the next picture, which is what a reader holding an
  // arrow key is actually asking for.
  const threadTotal = thread ? totalImages(thread.stops) : 0
  const threadPos = thread ? flatIndex(thread.stops, { stop: thread.stop, index }) : 0
  const hasThread = !!thread && threadTotal > 1
  const atThreadFirst = threadPos <= 0
  const atThreadLast = threadPos >= threadTotal - 1

  const open = useCallback(
    (next: LightboxItem[], startIndex = 0, nextThread?: LightboxThread) => {
      if (next.length === 0) return
      setItems(next)
      setIndex(Math.min(Math.max(0, startIndex), next.length - 1))
      setThread(nextThread && nextThread.stops.length > 0 ? nextThread : null)
    },
    [],
  )
  const close = useCallback(() => {
    setItems(null)
    setThread(null)
  }, [])
  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])
  const next = useCallback(
    () => setIndex((i) => (items ? Math.min(items.length - 1, i + 1) : i)),
    [items],
  )

  // Vertical: step one image along the conversation, crossing into the next
  // message when the current batch runs out. Clamped at both ends -- a move
  // that cannot happen does nothing, and this sequence is not a ring. Landing
  // in another message REPLACES the horizontal set with that message's batch,
  // so left/right keeps meaning "within the thing you are looking at".
  const goVertical = useCallback(
    (delta: 1 | -1) => {
      if (!thread) return
      const { stops } = thread
      const next = stepImage(stops, { stop: thread.stop, index }, delta)
      if (!next) return
      setThread({ stops, stop: next.stop })
      setItems(stops[next.stop])
      setIndex(next.index)
    },
    [thread, index],
  )

  // Fetch the current image full-res whenever it changes; revoke the prior blob.
  useEffect(() => {
    const cur = items && index >= 0 && index < items.length ? items[index] : null
    if (!client || !cur) {
      setSrc(null)
      setError(false)
      return
    }
    let cancelled = false
    setSrc(null)
    setError(false)

    fetchMediaSrc(client, cur.mxc, undefined, cur.roomId)
      .then(({ src: resolved, revoke }) => {
        if (cancelled) {
          revoke()
          return
        }
        revokeRef.current = revoke
        setSrc(resolved)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })

    return () => {
      cancelled = true
      if (revokeRef.current) {
        revokeRef.current()
        revokeRef.current = null
      }
    }
  }, [client, items, index])

  // Keyboard, per the formant axis grammar: Escape leaves the innermost open
  // thing, left/right walk the set you opened, up/down walk the conversation
  // that set came from. axisFromKey holds the two parts that were wrong in
  // different places across the estate -- the typing guard, and preventDefault
  // on the vertical only.
  useEffect(() => {
    if (!items) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!isTypingTarget(e.target)) close()
        return
      }
      switch (axisFromKey(e, BOTH)) {
        case 'prev':
          prev()
          break
        case 'next':
          next()
          break
        case 'up':
          goVertical(-1)
          break
        case 'down':
          goVertical(1)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items, close, prev, next, goVertical])

  // Download the already-fetched blob under a friendly filename. Reuses the
  // viewer's object URL, so no network round-trip.
  const save = useCallback(() => {
    if (!src || !current) return
    const a = document.createElement('a')
    a.href = src
    a.download = downloadName(current)
    document.body.appendChild(a)
    a.click()
    a.remove()
  }, [src, current])

  return (
    <LightboxContext.Provider value={{ open }}>
      {children}
      {current && (
        <div
          onClick={close}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Toolbar: stopPropagation so its clicks don't hit the closing backdrop. */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 8, alignItems: 'center' }}
          >
            {hasNav && (
              <span style={{ fontSize: 13, color: 'var(--cpd-color-text-secondary)', marginRight: 4 }}>
                {index + 1} / {items!.length}
              </span>
            )}
            {hasThread && (
              <span style={{ fontSize: 13, color: 'var(--cpd-color-text-secondary)', marginRight: 4 }}>
                {threadPos + 1} / {threadTotal} in thread
              </span>
            )}
            <button type="button" onClick={save} disabled={!src} style={toolbarBtn}>
              Save
            </button>
            <button type="button" onClick={close} style={toolbarBtn}>
              Close
            </button>
          </div>

          {hasNav && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                prev()
              }}
              disabled={atFirst}
              aria-label="Previous image"
              style={{ ...navBtn, left: 16, opacity: atFirst ? 0.35 : 1 }}
            >
              {'\u2039'}
            </button>
          )}

          {/* The pointer can do what the keys do: the vertical axis gets real
              controls, not a keyboard-only secret. */}
          {hasThread && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                goVertical(-1)
              }}
              disabled={atThreadFirst}
              aria-label="Previous image in thread"
              style={{ ...vertNavBtn, top: 12, opacity: atThreadFirst ? 0.35 : 1 }}
            >
              {'\u25b4'}
            </button>
          )}

          {/* Image area: stopPropagation so clicking the picture doesn't close. */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '92vw',
              maxHeight: '92vh',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {error ? (
              <span style={{ color: 'var(--cpd-color-text-secondary)', fontStyle: 'italic' }}>
                [image unavailable]
              </span>
            ) : src ? (
              <img
                src={src}
                alt={current.name ?? 'image'}
                style={{
                  maxWidth: '92vw',
                  maxHeight: hasThread ? '72vh' : '82vh',
                  objectFit: 'contain',
                  display: 'block',
                  borderRadius: 4,
                }}
              />
            ) : (
              <span style={{ color: 'var(--cpd-color-text-secondary)' }}>Loading...</span>
            )}
            {/* Full strip here: the lightbox is where a user actually reads the
                tag set, so no cap and no chip. */}
            <div style={{ maxWidth: '92vw', display: 'flex', justifyContent: 'center' }}>
              <MediaTags mxc={current.mxc} max={40} />
            </div>
          </div>

          {hasNav && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                next()
              }}
              disabled={atLast}
              aria-label="Next image"
              style={{ ...navBtn, right: 16, opacity: atLast ? 0.35 : 1 }}
            >
              {'\u203a'}
            </button>
          )}

          {hasThread && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                goVertical(1)
              }}
              disabled={atThreadLast}
              aria-label="Next image in thread"
              style={{ ...vertNavBtn, bottom: 12, opacity: atThreadLast ? 0.35 : 1 }}
            >
              {'\u25be'}
            </button>
          )}
        </div>
      )}
    </LightboxContext.Provider>
  )
}
