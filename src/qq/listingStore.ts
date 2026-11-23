import type { QqDirHandle, QqFileHandle } from './folderStore'
import { isHidden } from './qqGrid'

// ---------------------------------------------------------------------------
// QuickQueue's saved listings: what each folder held when it was last listed,
// kept so a reload, a return to a folder and a Scan never list it again
// unasked (operator 2026-11-23: a wait over about 10 s per load is not an
// acceptable cost, and listing data is not thrown away).
//
// Why it is needed. The browser gives a folder no modified time, so listing a
// folder again is the only way to see what changed, and on the Android tablet
// a listing arrives about 100 names at a time: a 25,000-name folder takes
// minutes, a 200,000-name tree far longer. So a folder is listed once, saved,
// and shown from what was saved, with the time it was listed; "List again"
// is the user's refresh. Nothing lists again on its own.
//
// Where it is kept. In the folder, `.quickqueue/<device id>.qql`, when
// QuickQueue may write there (the index's own folder, so every device reads
// it), and always in this browser too: browsing asks only to read, and a
// listing made while browsing must survive a reload all the same. On loading,
// every device's file and this browser's copy are read and, folder by folder,
// the newest listing wins.
//
// What is kept: names only, no sizes or dates (those cost a getFile() each on
// the tablet). Hidden names are not kept, as the panel never shows them.
// The bytes are JSON, gzip-compressed: about 2 MB for 200,000 names.
// ---------------------------------------------------------------------------

export const LISTING_SUFFIX = '.qql'
const FORMAT = 1

/** One folder as last listed. */
export interface SavedFolder {
  /** When the listing finished, ms since 1970. */
  at: number
  /** Subfolder names, as listed. */
  dirs: string[]
  /** File names, as listed: pictures and other files alike. */
  files: string[]
}

/** Folder path ('' the root, `/`-separated below it) to its listing. */
export type SavedListing = Map<string, SavedFolder>

/** A folder's listing from what a listing handed over. */
export function savedFolder(entries: Iterable<{ name: string; kind: 'directory' | 'file' }>, at: number): SavedFolder {
  const out: SavedFolder = { at, dirs: [], files: [] }
  for (const e of entries) {
    if (isHidden(e.name)) continue
    if (e.kind === 'directory') out.dirs.push(e.name)
    else out.files.push(e.name)
  }
  return out
}

/** Folder by folder, the newest listing of the two. */
export function mergeListings(into: SavedListing, from: SavedListing): SavedListing {
  for (const [path, f] of from) {
    const had = into.get(path)
    if (!had || f.at > had.at) into.set(path, f)
  }
  return into
}

// --- bytes -----------------------------------------------------------------------

type Row = [path: string, at: number, dirs: string[], files: string[]]

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream))
  return new Uint8Array(await out.arrayBuffer())
}

export async function encodeListing(listing: SavedListing): Promise<Uint8Array> {
  const rows: Row[] = [...listing].map(([p, f]) => [p, f.at, f.dirs, f.files])
  const json = JSON.stringify({ qql: FORMAT, folders: rows })
  return pipe(new TextEncoder().encode(json), new CompressionStream('gzip'))
}

/** The listing in `bytes`, or why it cannot be read. */
export async function decodeListing(bytes: Uint8Array): Promise<{ ok: true; listing: SavedListing } | { ok: false; reason: string }> {
  let doc: unknown
  try {
    doc = JSON.parse(new TextDecoder().decode(await pipe(bytes, new DecompressionStream('gzip'))))
  } catch {
    return { ok: false, reason: 'it is not a listing this version can read' }
  }
  const d = doc as { qql?: unknown; folders?: unknown }
  if (d?.qql !== FORMAT || !Array.isArray(d.folders)) return { ok: false, reason: 'it is a listing format this version does not know' }
  const listing: SavedListing = new Map()
  const names = (xs: unknown): xs is string[] => Array.isArray(xs) && xs.every((x) => typeof x === 'string')
  for (const r of d.folders as unknown[]) {
    if (!Array.isArray(r) || typeof r[0] !== 'string' || typeof r[1] !== 'number' || !names(r[2]) || !names(r[3])) {
      return { ok: false, reason: 'a folder in it is malformed' }
    }
    listing.set(r[0], { at: r[1], dirs: r[2], files: r[3] })
  }
  return { ok: true, listing }
}

// --- where it is kept ---------------------------------------------------------------

/** This browser's copy of one root's listing (folderStore.ts browserListing). */
export interface BrowserCopy {
  read(): Promise<Uint8Array | null>
  write(bytes: Uint8Array): Promise<void>
}

function errorName(e: unknown): string {
  return e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : ''
}

export interface LoadedListing {
  listing: SavedListing
  /** Files or copies that could not be read, in words for the user. */
  problems: string[]
}

/** Every device's listing in the folder and this browser's copy, merged. */
export async function loadListing(root: QqDirHandle, indexDir: string, browser: BrowserCopy | null): Promise<LoadedListing> {
  const out: LoadedListing = { listing: new Map(), problems: [] }
  const take = async (bytes: Uint8Array, label: string) => {
    const r = await decodeListing(bytes)
    if (r.ok) mergeListings(out.listing, r.listing)
    else out.problems.push(`${label} was skipped: ${r.reason}.`)
  }
  if (browser) {
    try {
      const b = await browser.read()
      if (b?.length) await take(b, 'The listing kept in this browser')
    } catch (e) {
      out.problems.push(`The listing kept in this browser could not be read (${errorName(e) || 'unknown error'}).`)
    }
  }
  let dir: QqDirHandle | null = null
  try {
    dir = await root.getDirectoryHandle(indexDir)
  } catch (e) {
    if (errorName(e) !== 'NotFoundError') {
      out.problems.push(`${indexDir} could not be opened (${errorName(e) || 'unknown error'}), so its saved listings were not read.`)
    }
  }
  if (dir) {
    for await (const h of dir.values()) {
      if (h.kind !== 'file' || !h.name.endsWith(LISTING_SUFFIX)) continue
      try {
        await take(new Uint8Array(await (await (h as QqFileHandle).getFile()).arrayBuffer()), `${indexDir}/${h.name}`)
      } catch (e) {
        out.problems.push(`${indexDir}/${h.name} could not be read (${errorName(e) || 'unknown error'}).`)
      }
    }
  }
  return out
}

/**
 * Keeps one root's listing up to date where it is stored. put() changes the
 * listing at once; the bytes are written a moment later, so a Scan listing a
 * tree folder by folder writes once every few seconds, not once a folder.
 * Into the folder only while QuickQueue may write there (asked, never
 * prompted for); into this browser always.
 */
export class ListingKeeper {
  readonly listing: SavedListing
  private readonly root: QqDirHandle
  private readonly indexDir: string
  private readonly fileName: string
  private readonly browser: BrowserCopy | null
  private readonly delayMs: number
  private timer: ReturnType<typeof setTimeout> | null = null
  private writing: Promise<void> | null = null
  private dirty = false
  private readonly onProblem: (problem: string) => void
  /** The last write's problem, until a write succeeds. */
  problem: string | null = null

  constructor(opts: {
    root: QqDirHandle; indexDir: string; deviceId: string; browser: BrowserCopy | null; listing?: SavedListing; delayMs?: number
    /** Told when a write fails, as it happens: a Scan's writes run unwatched. */
    onProblem?: (problem: string) => void
  }) {
    this.onProblem = opts.onProblem ?? (() => {})
    this.root = opts.root
    this.indexDir = opts.indexDir
    this.fileName = `${opts.deviceId}${LISTING_SUFFIX}`
    this.browser = opts.browser
    this.listing = opts.listing ?? new Map()
    this.delayMs = opts.delayMs ?? 3000
  }

  get(path: string): SavedFolder | undefined {
    return this.listing.get(path)
  }

  put(path: string, folder: SavedFolder): void {
    this.listing.set(path, folder)
    this.dirty = true
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; void this.flush() }, this.delayMs)
  }

  /** Writes now what put() has changed. */
  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    while (this.writing) await this.writing
    if (!this.dirty) return
    this.dirty = false
    const mine = this.write().catch((e) => {
      this.dirty = true
      this.problem = `The folder listing could not be saved (${errorName(e) || 'unknown error'}); it is shown, and saving is tried again with the next listing.`
      this.onProblem(this.problem)
    })
    this.writing = mine
    try { await mine } finally { if (this.writing === mine) this.writing = null }
  }

  private async write(): Promise<void> {
    const bytes = await encodeListing(this.listing)
    let saved = false
    let failure: unknown = null
    if (this.browser) {
      try { await this.browser.write(bytes); saved = true } catch (e) { failure = e }
    }
    let mayWrite = false
    try { mayWrite = (await this.root.queryPermission({ mode: 'readwrite' })) === 'granted' } catch { /* not granted */ }
    if (mayWrite) {
      let w
      try {
        const dir = await this.root.getDirectoryHandle(this.indexDir, { create: true })
        const h = await dir.getFileHandle(this.fileName, { create: true })
        w = await h.createWritable()
        await w.write(bytes)
        await w.close()
        saved = true
      } catch (e) {
        if (w) await w.abort().catch(() => {})
        failure ??= e
      }
    }
    if (!saved && failure) throw failure
    this.problem = null
  }
}

// --- handles from names ---------------------------------------------------------------

/**
 * A folder handle known only by its parent and name, from a saved listing.
 * The browser's handle is looked up on first use (one getDirectoryHandle, no
 * listing), then kept. A folder no longer there fails on use with
 * NotFoundError, as a stale handle does.
 */
export function lazyDir(parent: QqDirHandle, name: string): QqDirHandle {
  let real: Promise<QqDirHandle> | null = null
  const get = () => (real ??= parent.getDirectoryHandle(name).catch((e) => { real = null; throw e }))
  return {
    kind: 'directory',
    name,
    isSameEntry: async (other) => (await get()).isSameEntry(other),
    queryPermission: async (o) => (await get()).queryPermission(o),
    requestPermission: async (o) => (await get()).requestPermission(o),
    values: () => ({
      async *[Symbol.asyncIterator]() { yield* (await get()).values() },
    }),
    getDirectoryHandle: async (n, o) => (await get()).getDirectoryHandle(n, o),
    getFileHandle: async (n, o) => (await get()).getFileHandle(n, o),
  }
}

/** A file handle known only by its folder and name; see lazyDir. */
export function lazyFile(parent: QqDirHandle, name: string): QqFileHandle {
  let real: Promise<QqFileHandle> | null = null
  const get = () => (real ??= parent.getFileHandle(name).catch((e) => { real = null; throw e }))
  return {
    kind: 'file',
    name,
    getFile: async () => (await get()).getFile(),
    createWritable: async (o) => (await get()).createWritable(o),
  }
}
