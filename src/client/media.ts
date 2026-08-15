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
  // The room we are rendering. Only ever needed for ENCRYPTED rooms: the mxc
  // lives inside the ciphertext, so the server cannot see which room it belongs
  // to and has no way to authorize it otherwise. Sending it is not a claim of
  // access -- the server still checks we are joined to this room, and only
  // honours the hint when the room really is encrypted.
  if (roomId) q.set('room_id', roomId)
  const qs = q.toString()
  return qs ? `${path}?${qs}` : path
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

  const token = client.getAccessToken()
  if (!token) throw new Error('no access token available for media fetch')

  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!resp.ok) {
    // Keep the body. Discarding it is why a media failure could only ever be
    // diagnosed from the browser's network tab.
    const detail = await resp.text().catch(() => '')
    throw new Error(
      `media fetch failed (${resp.status}) ${url} :: ${detail.slice(0, 200)}`,
    )
  }
  const objUrl = URL.createObjectURL(await resp.blob())
  return { src: objUrl, revoke: () => URL.revokeObjectURL(objUrl) }
}
