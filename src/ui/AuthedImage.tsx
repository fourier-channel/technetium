import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useClient } from '../client/ClientContext'
import { fetchMediaSrc, type ThumbSize } from '../client/media'
import { reportIgnored } from '../client/report'

// Retry transient media failures (heavy sync starves fetches) before showing the
// unavailable state: ~0.8s, 1.6s, 3.2s, 6.4s -> gives up after ~12s.
const MEDIA_MAX_RETRIES = 4
const MEDIA_RETRY_BASE_MS = 800

// Fallback box width for a lazy image whose event carried no dimensions.
const PLACEHOLDER_W = 320

// Renders an mxc:// image by fetching it through the media gateway with the
// client's bearer token and showing the resulting blob. Owns the object-URL
// lifecycle: fetch on mount / mxc change, revoke on cleanup so blobs don't leak
// as the timeline scrolls. `width` requests a thumbnail; omit for full size.
export function AuthedImage({
  mxc,
  width,
  roomId,
  alt,
  maxHeight = 320,
  onClick,
  fill = false,
  transparentLoading = false,
  fallback,
  reserve,
  lazy = false,
}: {
  mxc: string
  width?: ThumbSize
  /** The room being rendered. Required for media in ENCRYPTED rooms. */
  roomId?: string
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
  // The box this image is KNOWN to occupy, derived from the event's own
  // info.w/info.h before anything is fetched. When given, the placeholder and
  // the loaded image are the same size, so the row's height is settled from
  // first paint and never changes.
  //
  // Without it an inline image is 120x90 while loading and up to maxHeight
  // afterwards -- a late jump of a couple hundred px per image, which is what
  // fought the timeline's follow-the-bottom behaviour.
  reserve?: { width: number; height: number }
  // Opt-in prefetch. Defer the fetch until the image is near the viewport, and
  // hold its space with a placeholder until it arrives.
  //
  // OPT-IN rather than universal, deliberately. Chrome -- avatars, emoji,
  // receipts, nav -- is small, already inside a sized parent, and wants to be
  // there the instant it renders. Only the big content pictures are worth
  // deferring, and they are the only ones whose late arrival shifts the page.
  lazy?: boolean
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
  // A lazy image starts un-requested and becomes requested once it is near the
  // viewport; an eager one is requested from the start.
  const [near, setNear] = useState(!lazy)
  const boxRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (!lazy || near) return
    const el = boxRef.current
    if (!el) return
    // No IntersectionObserver (or no element to watch) must mean "load it",
    // never "load it never". A missing capability may not become a blank
    // timeline.
    if (typeof IntersectionObserver === 'undefined') {
      // Off the effect body, like the reset below: a synchronous setState in an
      // effect is the cascading-render rule (G-tc01). The observer callback
      // needs no such care -- it already fires outside render.
      queueMicrotask(() => setNear(true))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true)
      },
      // Roughly a screen and a half of runway in each direction, so a picture
      // is already decoded by the time it scrolls in. This is what turns
      // "loads when you reach it" into "is simply there".
      { rootMargin: '800px 0px', threshold: 0 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [lazy, near])

  useEffect(() => {
    if (!client || !near) return
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    // Reset the attempt counter only when the SOURCE changes, not on a retry.
    const sourceKey = `${mxc}|${width ?? ''}|${roomId ?? ''}`
    // Names WHICH request shape failed. "An image did not load" does not say
    // whether the gateway's sized path broke or the whole media route did, and
    // those are very different faults. The width is in the scope because the
    // gateway snaps to a fixed size list, so one misconfigured size fails alone
    // -- invisible when every failure logs the same line.
    const failureScope = width ? `media: thumbnail w=${width}` : 'media: original'
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

    // One fetcher. The server decides whether an mxc is chrome or content and
    // applies the matching rule, so the call site no longer has to know --
    // which is what the flag used to encode, in nine places.
    fetchMediaSrc(client, mxc, width, roomId)
      .then(({ src: resolved, revoke }) => {
        if (cancelled) {
          // Component moved on before the fetch resolved — clean up immediately.
          revoke()
          return
        }
        revokeRef.current = revoke
        setSrc(resolved)
      })
      .catch((err: unknown) => {
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
          // Only once the retries are spent. Reporting each attempt would turn
          // an expected sync-starvation blip into four console lines per image,
          // which is how a log stops being read. fetchMediaSrc keeps the
          // response status and body in this error precisely so this line can
          // carry them (D-tp16).
          reportIgnored(failureScope, err)
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
  }, [client, mxc, width, roomId, retryTick, near])

  // The box this image occupies, and the single authority for it: the
  // placeholder and the loaded picture must agree exactly or the row resizes
  // the moment the bytes land, which is the shuffling this exists to stop.
  //
  // The event's own info.w/h when it has them. When it does not -- and only for
  // a lazy image, so nothing else changes shape -- a 4:3 box at the requested
  // thumbnail width. A guess, but a STABLE one, and a letterboxed picture beats
  // a timeline that jumps every time one arrives.
  const box =
    reserve ??
    (lazy && !fill
      ? {
          width: width ?? PLACEHOLDER_W,
          height: Math.round((width ?? PLACEHOLDER_W) * 0.75),
        }
      : undefined)

  if (error) {
    if (fallback !== undefined) return <>{fallback}</>
    return (
      <span style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--cpd-color-text-secondary)' }}>
        [image unavailable]
      </span>
    )
  }

  if (!src) {
    // A LAZY image must always render its box, even when transparent: the box
    // is both the space being held and the element the observer watches, so
    // returning null here would leave nothing to observe and the fetch would
    // never start at all.
    if (transparentLoading && !lazy) return null
    return (
      <span
        ref={boxRef}
        className={transparentLoading ? undefined : 'tc-media-ph'}
        style={
          fill
            ? { display: 'block', width: '100%', height: '100%' }
            : {
                display: 'block',
                width: box?.width ?? 120,
                height: box?.height ?? 90,
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
          : box
            ? {
                // Same box as the placeholder it replaces -- contain, so an
                // info.w/h that disagrees with the real thumbnail letterboxes
                // instead of resizing the row.
                width: box.width,
                height: box.height,
                objectFit: 'contain',
                maxWidth: '100%',
                borderRadius: 8,
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
