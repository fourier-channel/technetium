import { createLimiter } from '../client/concurrency'
import type { QqFileHandle } from './folderStore'

// ---------------------------------------------------------------------------
// Thumbnails for the QuickQueue grid, made on this device from the file.
//
// A picture is read only when its tile is mounted, and the grid mounts only
// the rows near the viewport (qqGrid.ts gridWindow), so scrolling past ten
// thousand files reads none of them. Reads queue LIFO in a limiter of their
// own (client/concurrency.ts, the one the room's media uses, as a separate
// instance so neither starves the other): the tile mounted last is the likeliest
// to be on screen, and a tile scrolled away before its turn gives its turn up
// without reading anything.
//
// A thumbnail is the picture decoded once, scaled to THUMB_PX wide and
// re-encoded small, so the grid holds a few KB per tile instead of a full
// decoded picture (a 1024x1536 generation is about 6 MB of pixels). The cache
// is bounded; the oldest URL is revoked when it is pushed out.
//
// Four at a time: on the Android tablet each open costs about 107 ms and each
// read call about 175 ms whatever the concurrency (sec 22.13), so more at
// once buys little there; on a PC four keep a scroll filling.
// ---------------------------------------------------------------------------

export const THUMB_PX = 256
const CACHE_MAX = 1500
const limiter = createLimiter(4)
const cache = new Map<string, string>()

function remember(key: string, url: string): void {
  cache.set(key, url)
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value as string
    URL.revokeObjectURL(cache.get(oldest)!)
    cache.delete(oldest)
  }
}

export function cachedThumb(key: string): string | null {
  const url = cache.get(key)
  if (!url) return null
  // Touched: move it to the young end, so what is in view is what is kept.
  cache.delete(key)
  cache.set(key, url)
  return url
}

async function render(handle: QqFileHandle): Promise<string> {
  const file = await handle.getFile()
  const bitmap = await createImageBitmap(file, { resizeWidth: THUMB_PX, resizeQuality: 'medium' })
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d canvas')
    ctx.drawImage(bitmap, 0, 0)
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 })
    return URL.createObjectURL(blob)
  } finally {
    bitmap.close()
  }
}

/** The thumbnail for `key`, made from `handle` if it is not cached. Rejects
 *  with 'skipped' when `stillWanted` says no by the time its turn comes. */
export function thumbFor(key: string, handle: QqFileHandle, stillWanted: () => boolean): Promise<string> {
  const hit = cachedThumb(key)
  if (hit) return Promise.resolve(hit)
  return limiter.run(async () => {
    const again = cachedThumb(key)
    if (again) return again
    if (!stillWanted()) throw new Error('skipped')
    const url = await render(handle)
    remember(key, url)
    return url
  })
}
