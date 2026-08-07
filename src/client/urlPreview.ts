import type { MatrixClient } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// W5.2 -- link previews.
//
// SERVER-GATED twice over. The endpoint is optional (`url_preview_enabled`),
// and it is an SSRF surface -- the server fetches a URL the user supplied, so
// a misconfigured `url_preview_ip_range_blacklist` lets a room member make the
// homeserver probe its own private network. That blacklist is not optional and
// it is not ours to set; this client only ASKS.
//
// So: probe once, cache, and when the server declines render NOTHING. A broken
// preview card on every link is worse than no previews.
//
// Opt-in per user as well, because a preview is a request to a third party
// made on the reader's behalf, and some people would rather it not happen.
// ---------------------------------------------------------------------------

export interface UrlPreview {
  url: string
  title?: string
  description?: string
  imageMxc?: string
}

const previewSupported = new WeakMap<MatrixClient, boolean>()
const cache = new Map<string, UrlPreview | null>()

// Only http(s). A preview request for anything else is either pointless or an
// invitation for the server to fetch something it should not.
export function isPreviewable(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined
}

export async function fetchPreview(
  client: MatrixClient,
  url: string,
  ts = Date.now(),
): Promise<UrlPreview | null> {
  if (!isPreviewable(url)) return null
  if (previewSupported.get(client) === false) return null
  if (cache.has(url)) return cache.get(url) ?? null

  try {
    const raw = (await client.getUrlPreview(url, ts)) as Record<string, unknown>
    const preview: UrlPreview = {
      url,
      title: str(raw['og:title']),
      description: str(raw['og:description']),
      imageMxc: str(raw['og:image']),
    }
    // A preview with nothing in it is not a preview.
    const useful = !!(preview.title || preview.description || preview.imageMxc)
    const result = useful ? preview : null
    cache.set(url, result)
    return result
  } catch (err) {
    const e = err as { httpStatus?: number; errcode?: string }
    if (
      e?.httpStatus === 403 ||
      e?.httpStatus === 404 ||
      e?.errcode === 'M_UNKNOWN' ||
      e?.errcode === 'M_FORBIDDEN'
    ) {
      // The server has previews off, or refuses this URL. Stop asking.
      previewSupported.set(client, false)
    }
    cache.set(url, null)
    return null
  }
}

// First http(s) link in a message body, or null. One preview per message: a
// wall of cards under a message full of links is its own problem.
export function firstLink(body: string): string | null {
  const m = /(https?:\/\/[^\s<>"']+)/i.exec(body)
  if (!m) return null
  // Trailing punctuation is almost never part of the URL someone typed.
  const url = m[1].replace(/[.,;:!?)\]}]+$/, '')
  return isPreviewable(url) ? url : null
}
