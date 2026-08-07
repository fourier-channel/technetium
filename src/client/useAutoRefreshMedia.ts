import { useEffect, useState } from 'react'
import type { MatrixClient } from 'matrix-js-sdk'
import { fetchMediaSrc } from './media'

// ---------------------------------------------------------------------------
// Auto-refreshing full-resolution media for LONG-LIVED backdrops (domain
// background, chat-window background). These render for the whole time a room
// is open -- potentially hours -- so unlike a scrolling timeline image they
// outlive the volatile bits of the media pipeline:
//
//   - the MAS access token expires + refreshes mid-session (a re-fetch during
//     the swap window can 401),
//   - a heavy sync transiently starves a fetch,
//   - the underlying object URL is revoked if the component briefly remounts.
//
// The previous domain-background layer fetched ONCE and, on any failure, set the
// source to null -- so a single transient error blanked the background for the
// rest of the session ("it disappeared after a while"). This hook instead:
//   - KEEPS the last good image on failure (never blanks a working backdrop),
//   - retries with backoff,
//   - periodically re-fetches and re-fetches on tab-focus / back-online,
// so the backdrop self-heals. It swaps to the fresh blob only once loaded, then
// revokes the previous one, so there is no flash to empty.
//
// ROUTING (corrected): backdrops resolve through the fourier-auth gateway, the
// same read path as every other uploaded image. They were previously fetched
// direct from the homeserver's /_matrix/client/v1/media/download, which was not
// intentional -- and which produced M_MISSING_TOKEN, because the Authorization
// header this client sends is lost in transit on that route (a cross-origin
// redirect strips it, as does a proxy that does not forward it on its media
// path). The gateway's ORIGINAL response is a presigned URL delivered as JSON
// rather than a redirect, so there is no header to lose.
//
// The gateway must authorize backdrop media by ROOM MEMBERSHIP for this to
// serve: if a user can see the room in Matrix, the same token must fetch its
// background anywhere in the suite. Until it does, a backdrop 403s VISIBLY
// rather than falling back to a path that was never meant to carry it.
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS = 4 * 60 * 1000 // gentle periodic re-fetch
const RETRY_BASE_MS = 1500
const RETRY_MAX_MS = 30 * 1000

export function useAutoRefreshMedia(
  client: MatrixClient | null,
  mxc: string | null,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): string | null {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    if (!client || !mxc) {
      // Clear off the effect body (a microtask, not a synchronous setState in
      // the effect -- react-hooks/set-state-in-effect, cf. AuthedImage).
      queueMicrotask(() => {
        if (alive) setSrc(null)
      })
      return () => {
        alive = false
      }
    }
    let currentRevoke: (() => void) | null = null
    let retryDelay = RETRY_BASE_MS
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    const load = () => {
      // Through the GATEWAY, like every other uploaded image. Backdrops are
      // user-uploaded content, not chrome, and they are uploaded by the very
      // same call as a chat image -- so they belong on the same read path.
      fetchMediaSrc(client, mxc)
        .then((r) => {
          if (!alive) {
            r.revoke()
            return
          }
          const prev = currentRevoke
          currentRevoke = r.revoke
          setSrc(r.src)
          retryDelay = RETRY_BASE_MS // success resets backoff
          // Revoke the previous blob after the swap so there is no flash.
          if (prev) setTimeout(prev, 1500)
        })
        .catch((err) => {
          if (!alive) return
          if (import.meta.env.DEV) console.warn('[tc] backdrop fetch failed:', err)
          // Keep the last good src (do NOT blank). Retry with backoff.
          retryTimer = setTimeout(load, retryDelay)
          retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS)
        })
    }

    load()
    const interval = setInterval(load, intervalMs)
    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', load)

    return () => {
      alive = false
      clearInterval(interval)
      if (retryTimer) clearTimeout(retryTimer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', load)
      if (currentRevoke) currentRevoke()
    }
  }, [client, mxc, intervalMs])

  return src
}
