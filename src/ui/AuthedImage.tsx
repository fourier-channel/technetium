import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useClient } from '../client/ClientContext'
import { fetchMediaSrc, fetchHomeserverThumb, type ThumbSize } from '../client/media'

// Retry transient media failures (heavy sync starves fetches) before showing the
// unavailable state: ~0.8s, 1.6s, 3.2s, 6.4s -> gives up after ~12s.
const MEDIA_MAX_RETRIES = 4
const MEDIA_RETRY_BASE_MS = 800

// Renders an mxc:// image by fetching it through the media gateway with the
// client's bearer token and showing the resulting blob. Owns the object-URL
// lifecycle: fetch on mount / mxc change, revoke on cleanup so blobs don't leak
// as the timeline scrolls. `width` requests a thumbnail; omit for full size.
export function AuthedImage({
  mxc,
  width,
  alt,
  maxHeight = 320,
  onClick,
  fill = false,
  transparentLoading = false,
  fallback,
  viaHomeserver = false,
}: {
  mxc: string
  width?: ThumbSize
  alt?: string
  maxHeight?: number
  onClick?: () => void
  fill?: boolean
  transparentLoading?: boolean
  // Rendered instead of the "[image unavailable]" text when the fetch fails
  // (e.g. a room avatar the media gateway can't serve -> fall back to an initial).
  fallback?: ReactNode
  // Fetch via the homeserver's authenticated-media endpoint instead of the
  // fourier-auth gateway. Used for avatars/chrome, which the content gate 403s.
  viaHomeserver?: boolean
}) {
  const { client } = useClient()
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [retryTick, setRetryTick] = useState(0)
  // Track the current object URL across renders so cleanup always revokes the
  // exact blob this instance created, even if mxc changes mid-flight.
  const revokeRef = useRef<(() => void) | null>(null)
  // Retry bookkeeping. Ref writes happen in the EFFECT (allowed), never render.
  const attemptsRef = useRef(0)
  const sourceKeyRef = useRef('')

  useEffect(() => {
    if (!client) return
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    // Reset the attempt counter only when the SOURCE changes, not on a retry.
    const sourceKey = `${mxc}|${width ?? ''}|${viaHomeserver}`
    if (sourceKeyRef.current !== sourceKey) {
      sourceKeyRef.current = sourceKey
      attemptsRef.current = 0
    }

    // Reset for the new mxc off the effect body (a microtask -- not a synchronous
    // setState-in-effect) so the previous image clears before the new one loads.
    queueMicrotask(() => {
      if (!cancelled) {
        setSrc(null)
        setError(false)
      }
    })

    const fetcher = viaHomeserver
      ? fetchHomeserverThumb(client, mxc, width ?? 96)
      : fetchMediaSrc(client, mxc, width)
    fetcher
      .then(({ src: resolved, revoke }) => {
        if (cancelled) {
          // Component moved on before the fetch resolved — clean up immediately.
          revoke()
          return
        }
        revokeRef.current = revoke
        setSrc(resolved)
      })
      .catch(() => {
        if (cancelled) return
        // A heavy initial sync starves media fetches, so a failure here is
        // usually transient. Retry with backoff before giving up, so images
        // self-heal instead of sticking at "[image unavailable]" until the user
        // navigates away and back (CD-10 go-fish; no dead states).
        if (attemptsRef.current < MEDIA_MAX_RETRIES) {
          const delay = MEDIA_RETRY_BASE_MS * 2 ** attemptsRef.current
          attemptsRef.current += 1
          retryTimer = setTimeout(() => {
            if (!cancelled) setRetryTick((t) => t + 1)
          }, delay)
        } else {
          setError(true)
        }
      })

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      if (revokeRef.current) {
        revokeRef.current()
        revokeRef.current = null
      }
    }
  }, [client, mxc, width, viaHomeserver, retryTick])

  if (error) {
    if (fallback !== undefined) return <>{fallback}</>
    return (
      <span style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--cpd-color-text-secondary)' }}>
        [image unavailable]
      </span>
    )
  }

  if (!src) {
    // Render nothing while loading so a layer behind (e.g. a gallery cell's
    // pending graphic) shows through until the image paints over it.
    if (transparentLoading) return null
    return (
      <span
        style={
          fill
            ? { display: 'block', width: '100%', height: '100%', background: 'var(--cpd-color-bg-subtle-secondary)' }
            : {
                display: 'inline-block',
                width: 120,
                height: 90,
                borderRadius: 8,
                background: 'var(--cpd-color-bg-subtle-secondary)',
              }
        }
        aria-label="loading image"
      />
    )
  }

  return (
    <img
      src={src}
      alt={alt ?? 'image'}
      onClick={onClick}
      style={
        fill
          ? {
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
              cursor: onClick ? 'pointer' : 'default',
            }
          : {
              maxWidth: '100%',
              maxHeight,
              borderRadius: 8,
              display: 'block',
              cursor: onClick ? 'pointer' : 'default',
            }
      }
    />
  )
}
