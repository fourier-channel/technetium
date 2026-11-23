import { createLimiter } from '../client/concurrency'
import type { QqFileHandle } from './folderStore'

// ---------------------------------------------------------------------------
// Thumbnails for the QuickQueue grid, made on this device from the file, and
// kept in this browser so a reload does not read every picture again.
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
// decoded picture (a 1024x1536 generation is about 6 MB of pixels).
//
// Kept in this browser (operator 2026-11-23, "Yes, browser only"; memory
// every-image-exists-once). On the tablet each file costs an open (about
// 107 ms) and a read (about 175 ms) before it is decoded, so a screenful made
// again on every reload is seconds of waiting; a saved one is a database read.
// The ruling's limits are the design: only this browser's own IndexedDB (never
// the folder, never anything another device or surface reads), bounded to
// STORED_BYTES with the least recently used dropped first, gone with purge (it
// deletes the database) and with forgetting the folder (folderStore.ts
// forgetRoot).
//
// Bounded by bytes, not by count: a thumbnail is about 1 KB for a flat picture
// and 34 KB for the worst case (noise, measured in Chromium), so a count says
// little about the disk. 256 MB holds about 7,800 thumbnails at the worst case
// and many times that for ordinary pictures. "Used" is when it was made or
// last shown; a shown thumbnail's time is moved on at most once a week, so a
// folder visited every day keeps its thumbnails while a folder browsed once
// gives its up first, at the cost of one rewrite per thumbnail per week.
//
// A saved thumbnail is used without opening its file -- opening it is the
// cost being saved -- so it is matched by path only. A picture replaced under
// the same name shows its old thumbnail until it is opened full screen: the
// open compares size and modified time and, if either changed, the saved
// thumbnail is dropped and made again (fileOpened). The same trade the index
// makes (QQ_FOLDER_INDEX.md sec 3), for a picture rather than a prompt.
//
// Four at a time: on the tablet concurrency barely helps (sec 22.13); on a PC
// four keep a scroll filling. Database reads are not file reads and do not
// queue behind them: the tiles mounted in one frame are fetched in one
// transaction.
// ---------------------------------------------------------------------------

export const THUMB_PX = 256
/** Bytes of thumbnails kept in this browser, across all folders. */
export const STORED_BYTES = 256 * 1024 * 1024
/** A shown thumbnail's last-used time is moved on once it is this old. */
export const TOUCH_AFTER_MS = 7 * 24 * 3600 * 1000

/** One thumbnail as kept in this browser. */
export interface StoredThumb {
  /** `<root id>/<folder path>/<file name>`, as the grid names it. */
  key: string
  blob: Blob
  /** The file's size and modified time when the thumbnail was made. */
  size: number
  modified: number
  /** When it was made or last used, ms since 1970: the least recently used
   *  is dropped first. */
  at: number
}

/** Where thumbnails are kept (folderStore.ts browserThumbs). */
export interface ThumbStore {
  getMany(keys: string[]): Promise<Map<string, StoredThumb>>
  putMany(rows: StoredThumb[]): Promise<void>
  remove(key: string): Promise<void>
  /** Drops the least recently used until at most `maxBytes` of thumbnails remain. */
  trim(maxBytes: number): Promise<void>
}

export interface ThumbsOptions {
  store: ThumbStore | null
  /** The file decoded, scaled and re-encoded. */
  render: (file: File) => Promise<Blob>
  makeUrl?: (blob: Blob) => string
  revokeUrl?: (url: string) => void
  /** Object URLs held in memory at once. */
  memoryMax?: number
  storedBytes?: number
  /** Saving waits this long so a scroll's thumbnails are written together. */
  saveDelayMs?: number
  /** Trimmed after this many thumbnails are written. */
  trimEvery?: number
  concurrency?: number
  now?: () => number
}

export interface Thumbs {
  cachedThumb(key: string): string | null
  thumbFor(key: string, handle: QqFileHandle, stillWanted: () => boolean): Promise<string>
  /** Called with the file when a picture is opened full screen. */
  fileOpened(key: string, file: File): Promise<void>
  /** Writes what is waiting to be saved. */
  flush(): Promise<void>
  /** Told once, the first time this browser's store fails; thumbnails are still made. */
  onProblem: ((problem: string) => void) | null
}

function errorName(e: unknown): string {
  return e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : ''
}

export function createThumbs(opts: ThumbsOptions): Thumbs {
  const makeUrl = opts.makeUrl ?? ((b: Blob) => URL.createObjectURL(b))
  const revokeUrl = opts.revokeUrl ?? ((u: string) => URL.revokeObjectURL(u))
  const memoryMax = opts.memoryMax ?? 1500
  const storedBytes = opts.storedBytes ?? STORED_BYTES
  const saveDelayMs = opts.saveDelayMs ?? 500
  const trimEvery = opts.trimEvery ?? 500
  const now = opts.now ?? Date.now
  const limiter = createLimiter(opts.concurrency ?? 4)
  const memory = new Map<string, string>()
  const store = opts.store

  let told = false
  const problem = (what: string, e: unknown) => {
    if (told) return
    told = true
    self.onProblem?.(`Thumbnails could not be ${what} this browser (${errorName(e) || 'unknown error'}), so they are made from the files on each visit.`)
  }

  function remember(key: string, url: string): void {
    memory.set(key, url)
    while (memory.size > memoryMax) {
      const oldest = memory.keys().next().value as string
      revokeUrl(memory.get(oldest)!)
      memory.delete(oldest)
    }
  }

  function cachedThumb(key: string): string | null {
    const url = memory.get(key)
    if (!url) return null
    // Touched: move it to the young end, so what is in view is what is kept.
    memory.delete(key)
    memory.set(key, url)
    return url
  }

  // --- reads from the store, batched per frame -----------------------------------
  let asked = new Map<string, Array<(row: StoredThumb | undefined) => void>>()
  let askTimer: ReturnType<typeof setTimeout> | null = null
  function stored(key: string): Promise<StoredThumb | undefined> {
    if (!store) return Promise.resolve(undefined)
    return new Promise((resolve) => {
      const waiting = asked.get(key)
      if (waiting) waiting.push(resolve)
      else asked.set(key, [resolve])
      askTimer ??= setTimeout(() => {
        askTimer = null
        const batch = asked
        asked = new Map()
        store.getMany([...batch.keys()]).then(
          (rows) => { for (const [k, rs] of batch) for (const r of rs) r(rows.get(k)) },
          (e) => { problem('read from', e); for (const rs of batch.values()) for (const r of rs) r(undefined) },
        )
      }, 0)
    })
  }

  // --- writes to the store, batched ------------------------------------------------
  let pending: StoredThumb[] = []
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let writing: Promise<void> | null = null
  let sinceTrim = 0
  async function flush(): Promise<void> {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    while (writing) await writing
    if (!store || pending.length === 0) return
    const rows = pending
    pending = []
    const mine = (async () => {
      try {
        await store.putMany(rows)
        sinceTrim += rows.length
        if (sinceTrim >= trimEvery) { sinceTrim = 0; await store.trim(storedBytes) }
      } catch (e) {
        problem('saved in', e)
      }
    })()
    writing = mine
    try { await mine } finally { if (writing === mine) writing = null }
  }
  function save(row: StoredThumb): void {
    if (!store) return
    pending.push(row)
    saveTimer ??= setTimeout(() => { saveTimer = null; void flush() }, saveDelayMs)
  }

  async function thumbFor(key: string, handle: QqFileHandle, stillWanted: () => boolean): Promise<string> {
    const hit = cachedThumb(key)
    if (hit) return hit
    const row = await stored(key)
    const again = cachedThumb(key)
    if (again) return again
    if (row) {
      if (now() - row.at > TOUCH_AFTER_MS) save({ ...row, at: now() })
      const url = makeUrl(row.blob)
      remember(key, url)
      return url
    }
    return limiter.run(async () => {
      const third = cachedThumb(key)
      if (third) return third
      if (!stillWanted()) throw new Error('skipped')
      const file = await handle.getFile()
      const blob = await opts.render(file)
      save({ key, blob, size: file.size, modified: file.lastModified, at: now() })
      const url = makeUrl(blob)
      remember(key, url)
      return url
    })
  }

  async function fileOpened(key: string, file: File): Promise<void> {
    const row = pending.find((r) => r.key === key) ?? (await stored(key))
    if (!row || (row.size === file.size && row.modified === file.lastModified)) return
    pending = pending.filter((r) => r.key !== key)
    // Not revoked: a tile on screen may still be drawing it. It is made again
    // the next time its tile mounts.
    memory.delete(key)
    if (store) {
      try { await store.remove(key) } catch (e) { problem('saved in', e) }
    }
  }

  const self: Thumbs = { cachedThumb, thumbFor, fileOpened, flush, onProblem: null }
  return self
}

/** The thumbnail, made from the file: decoded once, scaled, re-encoded small. */
export async function renderThumb(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { resizeWidth: THUMB_PX, resizeQuality: 'medium' })
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d canvas')
    ctx.drawImage(bitmap, 0, 0)
    return await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 })
  } finally {
    bitmap.close()
  }
}
