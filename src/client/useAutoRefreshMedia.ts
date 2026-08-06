import { useEffect, useState } from 'react'
import type { MatrixClient } from 'matrix-js-sdk'
import { fetchHomeserverMedia } from './media'

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
// (Root-cause note: domain backgrounds are homeserver blobs, which don't expire
// on their own; the observed vanishing was the blank-on-transient-failure path
// above, plus token churn. This is the defensive fix the operator asked for.)
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
      fetchHomeserverMedia(client, mxc)
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
        .catch(() => {
          if (!alive) return
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
