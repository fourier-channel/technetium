import type { MatrixClient } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// Media. ONE path, for every mxc, every size, every caller.
//
// It used to be three. An original went to the fourier-auth gateway, which
// returned a JSON envelope wrapping a presigned R2 URL that was then handed to
// an <img src> -- four hundred characters of X-Amz-Signature in the DOM. A
// thumbnail went to the same gateway but got bytes back. And anything the
// gateway called chrome went straight to the homeserver instead, because the
// gate 403'd avatars: fetchHomeserverThumb existed purely to route around a
// server that was answering the wrong question.
//
// The server now classifies media itself -- site asset (avatar, emoji, room
// icon) versus content -- and applies the matching rule, so the client no
// longer has to know which is which. Everything is:
//
//   GET {homeserver}/_matrix/client/v1/media/{download,thumbnail}/{server}/{id}
//   Authorization: Bearer <token>
//
// which is the standard Matrix authenticated-media endpoint. Cloudflare serves
// it from R2; 41chan never touches the bytes. No envelope, no presigned URL, no
// second path for chrome, nothing to cache-and-reuse before it expires.
// ---------------------------------------------------------------------------

// Thumbnail widths the server honors (snapped server-side to its
// ALLOWED_THUMB_SIZES). Exposed so callers pick a real size, not an arbitrary
// one that would just get snapped anyway.
export const THUMB_SIZES = [180, 320, 360, 720, 850] as const
export type ThumbSize = (typeof THUMB_SIZES)[number]

export interface ParsedMxc {
  serverName: string
  mediaId: string
}

// Parse an mxc:// URI into { serverName, mediaId }, or null if it isn't a
// well-formed mxc:// (so callers can fall back to showing the raw body).
export function parseMxc(mxc: string): ParsedMxc | null {
  const m = /^mxc:\/\/([^/]+)\/([^/?#]+)$/.exec(mxc.trim())
  if (!m) return null
  return { serverName: m[1], mediaId: m[2] }
}

// Build the media URL for an mxc. With `width`, a thumbnail; without, the full
// download. Returns null for a malformed mxc.
//
// The homeserver's own origin, not a separate gateway host: this is the URL
// Element already uses, so both clients hit the same path and get the same
// answer from the same check. A second origin would be a second path, which is
// the thing being removed.
export function mediaUrl(
  client: MatrixClient,
  mxc: string,
  width?: ThumbSize,
  roomId?: string,
): string | null {
  const parsed = parseMxc(mxc)
  if (!parsed) return null
  const base = client.getHomeserverUrl().replace(/\/+$/, '')
  const kind = width ? 'thumbnail' : 'download'
  const path =
    `${base}/_matrix/client/v1/media/${kind}/` +
    `${encodeURIComponent(parsed.serverName)}/${encodeURIComponent(parsed.mediaId)}`
  const q = new URLSearchParams()
  if (width) {
    q.set('width', String(width))
    q.set('height', String(width))
    q.set('method', 'scale')
  }
  // The room hint, sent ONLY when the room is actually encrypted -- which is
  // what this comment always claimed and the code did not do.
  //
  // In an ENCRYPTED room the mxc lives inside the ciphertext, so the server
  // cannot see which room the media belongs to and has no other way to
  // authorize it. In an UNENCRYPTED room the server can already see the event,
  // so the hint tells it nothing it does not know -- and sending it anyway asks
  // a stricter question ("is this media yours in THAT room") about media that
  // is legitimately rendered elsewhere: a forward, a thread panel, a gallery
  // cell. That is the shape of 403 this path has already produced twice, and
  // the branch avatars never take -- which is why avatars were never affected.
  const encrypted = roomId ? (client.getRoom(roomId)?.hasEncryptionStateEvent() ?? false) : false
  if (roomId && encrypted) q.set('room_id', roomId)
  const qs = q.toString()
  return qs ? `${path}?${qs}` : path
}

// ---------------------------------------------------------------------------
// Blob cache.
//
// The HTTP response is immutable and cached for a year, so re-viewing an image
// costs no network. It still cost a fresh createObjectURL and a fresh decode on
// every mount, and AuthedImage blanks its src before fetching -- so an image
// you had already seen visibly reloaded every time you opened it.
//
// The version of this file before the one-path rewrite cached resolved URLs for
// exactly this reason. Removing it was a regression: "no URL whose lifetime
// needs managing" was true of PRESIGNED urls and said nothing about blobs.
//
// Refcounted, because the alternative is choosing between two bugs. Revoking on
// every unmount is what caused this; never revoking leaks every image the
// session ever displayed. So: hand the same object URL to every caller that
// wants it, and only revoke once nothing holds it AND it has aged out.
// ---------------------------------------------------------------------------

const BLOB_CACHE_MAX = 64

interface CachedBlob {
  url: string
  refs: number
}

const blobs = new Map<string, CachedBlob>()
const inFlight = new Map<string, Promise<string>>()

function release(key: string): void {
  const e = blobs.get(key)
  if (e && e.refs > 0) e.refs -= 1
  evict()
}

// Only entries nothing is holding are evictable; a wall of thumbnails larger
// than the cache must not revoke a URL that is still on screen.
function evict(): void {
  if (blobs.size <= BLOB_CACHE_MAX) return
  for (const [k, e] of blobs) {
    if (blobs.size <= BLOB_CACHE_MAX) break
    if (e.refs === 0) {
      URL.revokeObjectURL(e.url)
      blobs.delete(k)
    }
  }
}

/** For tests and diagnostics: how many blobs are held, and by how many callers. */
export function blobCacheStats(): { size: number; held: number } {
  let held = 0
  for (const e of blobs.values()) if (e.refs > 0) held += 1
  return { size: blobs.size, held }
}

// Fetch an mxc with the client's token and return an object URL for the bytes.
// The caller MUST revoke() on cleanup or it leaks the blob.
//
// A blob for everything, originals included. An <img src> cannot send an
// Authorization header, so the only alternatives are a credential in the URL
// (which is what the presigned envelope was, and why it is gone) or fetching
// the bytes ourselves. This is the second.
export async function fetchMediaSrc(
  client: MatrixClient,
  mxc: string,
  width?: ThumbSize,
  roomId?: string,
): Promise<{ src: string; revoke: () => void }> {
  const url = mediaUrl(client, mxc, width, roomId)
  if (!url) throw new Error(`invalid mxc URI: ${mxc}`)

  // Keyed by the URL ACTUALLY REQUESTED, not by the arguments that produced it.
  // The same picture shown in the room, in a thread panel and in a gallery cell
  // is one identical request once the room hint is gone -- keying on roomId
  // made it three cache entries and three downloads of the same bytes.
  const key = url

  // Already decoded and still held: hand back the SAME object URL, so the
  // browser reuses the image it already has rather than decoding it again.
  const cached = blobs.get(key)
  if (cached) {
    cached.refs += 1
    blobs.delete(key)
    blobs.set(key, cached) // touch for LRU
    return { src: cached.url, revoke: () => release(key) }
  }

  const token = client.getAccessToken()
  if (!token) throw new Error('no access token available for media fetch')

  // Coalesce concurrent requests for the same image. A timeline mounting the
  // same avatar twenty times at once should fetch once, not twenty times.
  let pending = inFlight.get(key)
  if (!pending) {
    pending = (async () => {
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (!resp.ok) {
        // Keep the body. Discarding it is why a media failure could only ever
        // be diagnosed from the browser's network tab.
        const detail = await resp.text().catch(() => '')
        throw new Error(
          `media fetch failed (${resp.status}) ${url} :: ${detail.slice(0, 200)}`,
        )
      }
      return URL.createObjectURL(await resp.blob())
    })()
    inFlight.set(key, pending)
    // `.finally()` returns a NEW promise, which rejects whenever `pending`
    // does -- and nothing awaits that one. The caller's `await pending` handles
    // the real rejection; this derived branch had no handler at all, which is
    // the "Uncaught (in promise)" a failing image produced. Neutralise the
    // derived chain ONLY: `pending` itself still rejects for whoever awaited
    // it, so the error still reaches AuthedImage's retry and report path.
    void pending.finally(() => inFlight.delete(key)).catch(() => {})
  }

  const objUrl = await pending

  const existing = blobs.get(key)
  if (existing) {
    // Another caller won the race and cached it; drop ours rather than leak.
    if (existing.url !== objUrl) URL.revokeObjectURL(objUrl)
    existing.refs += 1
    return { src: existing.url, revoke: () => release(key) }
  }
  blobs.set(key, { url: objUrl, refs: 1 })
  evict()
  return { src: objUrl, revoke: () => release(key) }
}
