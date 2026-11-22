import type { Keeper, QqDirHandle, QqFileHandle } from './folderStore'
import { embeddedChunks, promptSource, promptToTags } from './promptTags'
import { imageType, isHidden, naturalCompare } from './qqGrid'
import {
  mergeSegments, newDeviceId, pathKey, placeAll, readSegment, segmentName, SegmentWriter, winners, PARSER_VERSION,
  type Placed, type QqiFile, type QqiPrompt, type QqiRecord, type SegmentRead,
} from './qqi'

// ---------------------------------------------------------------------------
// QuickQueue's Scan (tc.152 step 2; QQ_M2_PLAN M2.2): builds the folder index
// for one picked root (QQ_FOLDER_INDEX.md in fourier-basis, secs 3, 3a, 7).
//
// 1. List the whole tree, names only. On the tablet a name is nearly free and
//    a getFile() costs about 107 ms (master reference sec 22.13), so listing
//    touches no file.
// 2. Read `.quickqueue/`: every device's segment, merged (qqi.ts).
// 3. Plan. A listed path the index knows is ADOPTED and never read. An index
//    path no longer listed is re-paired with an unknown name when exactly one
//    of each has that file name (a move: sec 3a step 1), else recorded gone.
//    Every other listed path is to be read, and so is one whose record an
//    older parser wrote.
// 4. Calibrate: read a few files, then STOP and state the cost -- files to
//    read, the time on this device, the index size (M2.2: "state the cost and
//    index size first, then build the index").
// 5. Read the rest, newest first, each with one getFile() and ONE read of the
//    first PREFIX_BYTES; a second, whole-file read only when the metadata the
//    parser reads runs past the prefix. Append what is learned to this
//    device's own segment, in frames.
//
// A wrong adoption cannot reach a post: the MD5 taken at selection re-reads
// the whole file and corrects the entry (sec 3).
//
// Nothing leaves the device. The prompts read here go into the user's own
// folder, beside the images they came from.
// ---------------------------------------------------------------------------

export const INDEX_DIR = '.quickqueue'

/**
 * How much of a file the first read takes. A PNG's text chunks sit before its
 * first IDAT; a JPEG's Exif before its first SOS.
 *
 * Measured 2026-11-22 over a 290,503-image generation library (263,174 JPEG,
 * 27,328 PNG, 1 WebP): the furthest point a reader had to reach to know it
 * held every metadata segment was 35,500 bytes (p99.9 about 12 KB). 64 KiB
 * covers every file, with 1.8x headroom; 32 KiB would miss 4 of them. No PNG
 * had text after its image data. On the tablet a read costs about the same
 * whatever its size, so the headroom is nearly free.
 *
 * A wrong size costs speed, never correctness: a prefix that falls short is
 * followed by a whole-file read (prefixSuffices), and progress().secondReads
 * counts those, the gauge beside this budget.
 */
export const PREFIX_BYTES = 64 * 1024

/** About what one scanned file adds to a segment: 42.6 bytes on the
 *  operator's library (QQ_FOLDER_INDEX.md sec 3c, 2026-11-22). A guide for
 *  the cost statement, said as "about". */
export const BYTES_PER_FILE = 43

// --- 1. listing --------------------------------------------------------------

export interface Listed {
  /** Every image under the root, by relative path (`/`-separated). */
  files: Map<string, QqFileHandle>
  /** Images directly in each folder; '' is the root. */
  folders: Map<string, number>
  /** Folders that could not be listed, and why. Shown, never dropped. */
  unlisted: { path: string; reason: string }[]
}

function errorName(e: unknown): string {
  return e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : ''
}

/** Lists the tree under `root`. Hidden entries (`.quickqueue/` among them)
 *  are skipped, as the panel skips them. A permission error ends the listing
 *  (it is the whole tree's); any other error loses one folder, said.
 *  `onProgress` is called at every entry, not only when a folder is done: one
 *  big folder can take minutes on a slow device, and a count that waits for
 *  it reads as a hang. `inFolder` is the folder being listed ('' the root). */
export async function listTree(
  root: QqDirHandle,
  onProgress?: (listed: number, folders: number, inFolder: string) => void,
  halted?: () => boolean,
  /** Filled as the listing goes, so a caller can draw it before it ends. */
  out: Listed = { files: new Map(), folders: new Map(), unlisted: [] },
): Promise<Listed> {
  const stack: [string, QqDirHandle][] = [['', root]]
  while (stack.length) {
    if (halted?.()) break
    const [path, dir] = stack.pop()!
    let n = 0
    try {
      for await (const h of dir.values()) {
        if (halted?.()) return out
        if (isHidden(h.name)) continue
        const rel = path ? `${path}/${h.name}` : h.name
        if (h.kind === 'directory') stack.push([rel, h])
        else if (imageType(h.name)) { out.files.set(rel, h); out.folders.set(path, ++n) }
        onProgress?.(out.files.size, out.folders.size, path)
      }
    } catch (e) {
      if (errorName(e) === 'NotAllowedError') throw e
      out.unlisted.push({ path: path || '(the picked folder)', reason: errorName(e) || 'unknown error' })
    }
    out.folders.set(path, n)
    onProgress?.(out.files.size, out.folders.size, path)
  }
  return out
}

// --- 2. the index on disk ----------------------------------------------------

export interface IndexRead {
  segments: SegmentRead[]
  /** Bytes of segment files read (all devices). */
  bytes: number
  /** Segment files refused whole or read in part, and why. */
  problems: string[]
}

export async function readIndex(root: QqDirHandle): Promise<IndexRead> {
  const out: IndexRead = { segments: [], bytes: 0, problems: [] }
  let dir: QqDirHandle
  try {
    dir = await root.getDirectoryHandle(INDEX_DIR)
  } catch (e) {
    if (errorName(e) === 'NotFoundError') return out // no index yet
    throw e
  }
  for await (const h of dir.values()) {
    if (h.kind !== 'file' || !h.name.endsWith('.qqi')) continue
    try {
      const bytes = new Uint8Array(await (await h.getFile()).arrayBuffer())
      out.bytes += bytes.length
      const r = await readSegment(bytes, h.name)
      if (!r.ok) { out.problems.push(`${INDEX_DIR}/${h.name} was skipped: ${r.reason}.`); continue }
      if (r.stopped) out.problems.push(`${INDEX_DIR}/${h.name} was read up to byte ${r.goodLength} of ${bytes.length}: ${r.stopped}.`)
      out.segments.push(r)
    } catch (e) {
      out.problems.push(`${INDEX_DIR}/${h.name} could not be read (${errorName(e) || 'unknown error'}).`)
    }
  }
  return out
}

// --- 3. the plan ---------------------------------------------------------------

export type Merged = Map<string, Placed & { record: QqiFile }>

export interface ScanPlan {
  adopted: number
  moves: { from: string; to: string }[]
  gone: string[]
  /** Paths to read, newest first (see newestFirst). */
  toRead: string[]
  /** Of toRead, known paths whose record an older parser wrote. */
  reparse: number
  /** What the plan itself tells the index: moves and gones. */
  records: QqiRecord[]
}

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)

/**
 * The order a Scan reads in. A file's date costs a getFile() each on the
 * tablet, so names stand in for it: every path segment compared in DESCENDING
 * natural order. Dated folders (`2026-11-22`) and counters
 * (`ComfyUI_00123_.png`, `00012-<seed>.png`) then come newest first.
 */
export function newestFirst(a: string, b: string): number {
  const x = a.split('/')
  const y = b.split('/')
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    // A file sorts after the folders beside it: their contents are newer
    // than a loose file only by the same guess, and a folder is one unit.
    const xFile = i === x.length - 1
    const yFile = i === y.length - 1
    if (xFile !== yFile) return xFile ? 1 : -1
    const c = naturalCompare(y[i], x[i])
    if (c) return c
  }
  return x.length - y.length
}

export function planScan(listedPaths: Iterable<string>, merged: Merged): ScanPlan {
  const plan: ScanPlan = { adopted: 0, moves: [], gone: [], toRead: [], reparse: 0, records: [] }
  const listed = new Map<string, string>()
  for (const p of listedPaths) listed.set(pathKey(p), p)

  const unknown: string[] = []
  for (const [k, p] of listed) {
    const e = merged.get(k)
    if (!e) unknown.push(p)
    else if (e.parserVersion < PARSER_VERSION) { plan.toRead.push(p); plan.reparse++ }
    else plan.adopted++
  }

  const group = <T>(xs: T[], name: (x: T) => string) => {
    const m = new Map<string, T[]>()
    for (const x of xs) {
      const k = pathKey(name(x))
      const l = m.get(k)
      if (l) l.push(x)
      else m.set(k, [x])
    }
    return m
  }
  const vanished = [...merged.entries()].filter(([k]) => !listed.has(k)).map(([, e]) => e)
  const vanishedByName = group(vanished, (e) => baseName(e.record.path))
  const unknownByName = group(unknown, baseName)
  const paired = new Set<Placed>()

  for (const to of unknown) {
    const n = pathKey(baseName(to))
    const vs = vanishedByName.get(n)
    if (vs?.length === 1 && unknownByName.get(n)!.length === 1 && vs[0].parserVersion >= PARSER_VERSION) {
      const from = vs[0]
      paired.add(from)
      plan.moves.push({ from: from.record.path, to })
      plan.records.push({ ...from.record, path: to }, { kind: 'gone', path: from.record.path })
    } else {
      plan.toRead.push(to)
    }
  }
  for (const e of vanished) {
    if (paired.has(e)) continue
    plan.gone.push(e.record.path)
    plan.records.push({ kind: 'gone', path: e.record.path })
  }
  plan.toRead.sort(newestFirst)
  return plan
}

// --- 5. reading one file ---------------------------------------------------------

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10]

/**
 * True when `head`, the first bytes of a file, already holds everything the
 * prompt parser (promptTags.ts) would read from the whole file, so a longer
 * read would find nothing more:
 * - PNG: the head reaches the first IDAT (or IEND). The parser also reads text
 *   chunks AFTER the image data; a prefix cannot see those, and the whole-file
 *   read at selection corrects such an entry. tools/qq-header-reach.mts counts
 *   them on a real library.
 * - JPEG: the head holds the first APP1 Exif segment whole (the parser reads
 *   only that one), or reaches SOS with none.
 * - WebP: never, unless the head is the whole file: RIFF lets EXIF follow the
 *   image.
 * - Anything else: the parser reads nothing from it, so yes; but a head too
 *   short to show which format it is (12 bytes) is never enough.
 */
export function prefixSuffices(head: Uint8Array): boolean {
  // Too short to tell what the file is: the parser may read it whole.
  if (head.length < 12) return false
  if (head.length >= 8 && PNG_SIG.every((b, i) => head[i] === b)) {
    let off = 8
    while (off + 8 <= head.length) {
      const type = String.fromCharCode(head[off + 4], head[off + 5], head[off + 6], head[off + 7])
      if (type === 'IDAT' || type === 'IEND') return true
      const len = ((head[off] << 24) >>> 0) + (head[off + 1] << 16) + (head[off + 2] << 8) + head[off + 3]
      off += 12 + len
    }
    return false
  }
  if (head.length >= 2 && head[0] === 0xff && head[1] === 0xd8) {
    // The same walk as promptTags.ts jpegTiff.
    let i = 2
    while (i + 4 <= head.length) {
      if (head[i] !== 0xff) { i += 1; continue }
      const marker = head[i + 1]
      if (marker === 0xff) { i += 1; continue }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
      if (marker === 0xd9 || marker === 0xda) return true
      const len = (head[i + 2] << 8) + head[i + 3]
      if (len < 2) return true
      const isExif = marker === 0xe1 && i + 10 <= head.length &&
        head[i + 4] === 0x45 && head[i + 5] === 0x78 && head[i + 6] === 0x69 && head[i + 7] === 0x66 && head[i + 8] === 0 && head[i + 9] === 0
      if (isExif) return i + 2 + len <= head.length
      i += 2 + len
    }
    return false
  }
  if (head.length >= 12 && String.fromCharCode(...head.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...head.subarray(8, 12)) === 'WEBP') {
    return false
  }
  return true
}

export interface EntryRead {
  record: QqiFile
  /** Read calls made: 1, or 2 when the prefix did not suffice. */
  reads: 1 | 2
}

export async function readEntry(path: string, handle: QqFileHandle, prefixBytes = PREFIX_BYTES): Promise<EntryRead> {
  const file = await handle.getFile()
  let bytes = new Uint8Array(await file.slice(0, Math.min(file.size, prefixBytes)).arrayBuffer())
  let reads: 1 | 2 = 1
  if (bytes.length < file.size && !prefixSuffices(bytes)) {
    bytes = new Uint8Array(await file.arrayBuffer())
    reads = 2
  }
  const src = promptSource(await embeddedChunks(bytes))
  let prompt: QqiPrompt | null = null
  if (src.prompt) {
    const t = promptToTags(src.prompt)
    prompt = { generator: src.key, tags: t.tags, meta: t.meta, characters: t.characters }
  }
  return { record: { kind: 'file', path, size: file.size, mtime: Math.floor(file.lastModified), prompt, params: [] }, reads }
}

// --- this device's own segment ------------------------------------------------------

/**
 * Where this device's segment is stored: `.quickqueue/` in the folder, or, for
 * a folder QuickQueue may not write, the keeper in this browser
 * (folderStore.ts). The bytes are the same either way (QQ_FOLDER_INDEX.md
 * sec 3c).
 */
export interface SegmentFile {
  /** Names the segment, to start a sentence for the user. */
  readonly label: string
  /** The file name readSegment checks the header against; none when the
   *  segment is not a file in the folder. */
  readonly fileName?: string
  /** The bytes as stored; empty when there are none yet. */
  read(): Promise<Uint8Array>
  /** Replaces everything from `offset` on with `bytes`, all or nothing. */
  writeAt(offset: number, bytes: Uint8Array): Promise<void>
}

export const KEPT_LABEL = 'The index kept in this browser for this folder'

/** This device's segment file in `.quickqueue/`, made if missing. */
export async function folderSegmentFile(root: QqDirHandle, deviceId: string): Promise<SegmentFile> {
  const dir = await root.getDirectoryHandle(INDEX_DIR, { create: true })
  const name = segmentName(deviceId)
  const handle = await dir.getFileHandle(name, { create: true })
  // The length last read or written; a write that starts before it cuts the
  // rest off first.
  let length = 0
  return {
    label: `This device's index file ${INDEX_DIR}/${name}`,
    fileName: name,
    async read() {
      const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer())
      length = bytes.length
      return bytes
    },
    // One writable: on failure it is aborted and the file is as it was.
    async writeAt(offset, bytes) {
      let w
      try {
        w = await handle.createWritable({ keepExistingData: true })
        if (offset < length) await w.truncate(offset)
        await w.seek(offset)
        await w.write(bytes)
        await w.close()
      } catch (e) {
        if (w) await w.abort().catch(() => {})
        throw e
      }
      length = offset + bytes.length
    },
  }
}

export function keptSegmentFile(keeper: Keeper): SegmentFile {
  return {
    label: KEPT_LABEL,
    read: async () => (await keeper.read()) ?? new Uint8Array(0),
    writeAt: (offset, bytes) => keeper.writeAt(offset, bytes),
  }
}

/**
 * This device's segment, opened for appending. Each append replaces the
 * stored bytes from the end of the last good frame on, all or nothing. The
 * writer's string tables then hold strings the store does not, so a failed
 * segment is never appended to again: the caller opens it afresh, which reads
 * the tables back.
 */
export class OwnSegment {
  private broken = false
  private readonly file: SegmentFile
  private readonly writer: SegmentWriter
  private offset: number
  /** What opening found wrong with the stored bytes, said once. */
  readonly problem: string | null

  private constructor(file: SegmentFile, writer: SegmentWriter, offset: number, problem: string | null) {
    this.file = file
    this.writer = writer
    this.offset = offset
    this.problem = problem
  }

  /** `deviceId` names a segment written from the start; one that reads is
   *  resumed under the id its header names. */
  static async open(file: SegmentFile, deviceId: string): Promise<OwnSegment> {
    const bytes = await file.read()
    if (bytes.length === 0) return new OwnSegment(file, SegmentWriter.fresh(deviceId), 0, null)
    const r = await readSegment(bytes, file.fileName)
    if (!r.ok) {
      return new OwnSegment(file, SegmentWriter.fresh(deviceId), 0,
        `${file.label} could not be read (${r.reason}), so it is being written again from the start.`)
    }
    const cut = r.goodLength < bytes.length ? r.goodLength : null
    return new OwnSegment(file, SegmentWriter.resume(r), r.goodLength,
      cut === null ? null : `${file.label} was damaged after byte ${cut} (${r.stopped}); everything before that is kept and the rest is written again.`)
  }

  get usable(): boolean { return !this.broken }

  async append(records: QqiRecord[], writtenAtSeconds: number): Promise<number> {
    if (this.broken) throw new Error('qq scan: append to a segment whose last append failed')
    const parts: Uint8Array[] = []
    if (this.offset === 0) parts.push(this.writer.header())
    try {
      parts.push(await this.writer.frame(records, writtenAtSeconds))
      const bytes = parts.length === 1 ? parts[0] : concat(parts)
      await this.file.writeAt(this.offset, bytes)
      this.offset += bytes.length
      return bytes.length
    } catch (e) {
      this.broken = true
      throw e
    }
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

// --- the device id -------------------------------------------------------------------

const DEVICE_KEY = 'net.41chan.qq_device'

/** This browser profile's device id, made once. If storage refuses, a new id
 *  is made each time and said: each session then writes a segment of its own,
 *  which costs space but never makes two writers of one file. */
export function storedDeviceId(): { id: string; kept: boolean } {
  try {
    const v = localStorage.getItem(DEVICE_KEY)
    if (v && /^[0-9a-f]{32}$/.test(v)) return { id: v, kept: true }
    const id = newDeviceId()
    localStorage.setItem(DEVICE_KEY, id)
    return { id, kept: true }
  } catch {
    return { id: newDeviceId(), kept: false }
  }
}

// --- the scan --------------------------------------------------------------------------

export type ScanPhase =
  | 'idle' | 'listing' | 'indexing' | 'calibrating'
  | 'planned' | 'reading' | 'pausing' | 'paused' | 'done' | 'stopped' | 'failed'

export interface ScanProgress {
  phase: ScanPhase
  listed: number
  folders: number
  /** While listing, the folder being listed below the root ('' the root). */
  listingIn: string
  /** Entries the index held when this scan began, from every device. */
  indexed: number
  adopted: number
  moved: number
  gone: number
  toRead: number
  read: number
  /** Reads that needed the whole file (the prefix did not suffice). */
  secondReads: number
  /** Files that could not be read; listed in `problems`, retried next scan. */
  unreadable: number
  /** Records written to this device's segment, and records waiting to be. */
  saved: number
  unsaved: number
  /** Seconds the reads still to do should take here, from this device's own
   *  rate so far. Null until a read has finished. */
  etaSeconds: number | null
  /** Segment bytes in `.quickqueue/` when the scan began, every device's. */
  indexBytes: number
  /** About what the reads still to do will add. */
  addBytes: number
  /** Everything that went wrong, in words for the user. Never dropped. */
  problems: string[]
}

export interface FolderCount { images: number; done: number; failed: number }

export interface ScanOptions {
  root: QqDirHandle
  deviceId: string
  /** Reads in flight at once. Default 4. */
  concurrency?: number
  /** Files read before the cost is stated. Default 16. */
  calibrate?: number
  /** A frame is written when this many records wait... */
  flushRecords?: number
  /** ...or this long has passed since the last write. */
  flushMs?: number
  prefixBytes?: number
  now?: () => number
  onProgress?: (p: ScanProgress) => void
  /** Web Locks; null runs unlocked (a check). One scan per browser profile at
   *  a time, so two tabs never write one segment. */
  locks?: LockManager | null
  /**
   * This folder's keeper in this browser (folderStore.ts browserKeeper). Its
   * segment is read with the folder's. Saving into the folder moves what it
   * holds there and then drops it; a folder that refuses writes part way
   * through switches saving to it, said once.
   */
  keeper?: Keeper | null
  /** Where this scan saves: 'browser' when the user did not allow writing
   *  into the folder (it needs a keeper). Default 'folder'. */
  saveTo?: 'folder' | 'browser'
}

/**
 * The stall watch (operator 2026-11-22, the same ruling as the pre-upload
 * check's: warned in advance, and the app watches for a stall, not the
 * user). In these phases the scan is working and reports every step; this
 * long with no step means it has probably stalled.
 */
export const STALL_MS = 60_000
const WATCHED: ReadonlySet<ScanPhase> = new Set(['listing', 'indexing', 'calibrating', 'reading', 'pausing'])
/** True when `idleMs` without a step is a stall in this phase. */
export function stalled(phase: ScanPhase, idleMs: number): boolean {
  return WATCHED.has(phase) && idleMs >= STALL_MS
}
/** Before Start nothing is written, so Stop ends these at once. */
const NOTHING_WRITTEN: ReadonlySet<ScanPhase> = new Set(['listing', 'indexing', 'calibrating'])

export const ONE_SCAN_AT_A_TIME =
  'Another tab of this browser is scanning. One scan runs at a time, so two tabs never write the same index file; close that scan first.'

export class FolderScan {
  private readonly o: Required<Omit<ScanOptions, 'onProgress' | 'locks' | 'keeper' | 'saveTo'>> & Pick<ScanOptions, 'onProgress' | 'locks' | 'keeper'>
  private p: ScanProgress = {
    phase: 'idle', listed: 0, folders: 0, listingIn: '', indexed: 0, adopted: 0, moved: 0, gone: 0, toRead: 0, read: 0,
    secondReads: 0, unreadable: 0, saved: 0, unsaved: 0, etaSeconds: null, indexBytes: 0, addBytes: 0, problems: [],
  }
  private listed: Listed | null = null
  private merged: Merged = new Map()
  private toRead: string[] = []
  private cursor = 0
  private pending: QqiRecord[] = []
  private own: OwnSegment | null = null
  private lastFlush = 0
  private flushing: Promise<void> | null = null
  private halt: 'pause' | 'stop' | null = null
  private readMs = 0
  private readsTimed = 0
  private lastEmit = 0
  private releaseLock: (() => void) | null = null
  /** Per folder: [images listed, indexed now, could not be read]. */
  private perFolder = new Map<string, [number, number, number]>()
  /** The listing as it grows; the calendar draws from it until the plan
   *  fills perFolder. */
  private listing: Listed = { files: new Map(), folders: new Map(), unlisted: [] }
  private planned = false
  private saveTo: 'folder' | 'browser'
  /** Records the keeper holds that win the merge: moved into the folder first. */
  private keptRecords = new Set<QqiRecord>()
  /** Drop the keeper once the folder holds its records. */
  private keptToDrop = false
  /** The id a keeper segment written from the start gets: never this
   *  device's folder id, so the two segments' records never share a seq. */
  private readonly keptDevice = newDeviceId()

  constructor(opts: ScanOptions) {
    this.o = {
      concurrency: 4, calibrate: 16, flushRecords: 10_000, flushMs: 30_000, prefixBytes: PREFIX_BYTES,
      now: () => Date.now(),
      ...opts,
    }
    if (opts.locks === undefined) {
      this.o.locks = typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null
    }
    this.saveTo = opts.saveTo ?? 'folder'
    if (this.saveTo === 'browser' && !opts.keeper) throw new Error('qq scan: saving to the browser needs a keeper')
  }

  progress(): ScanProgress {
    return { ...this.p, problems: [...this.p.problems] }
  }

  /** Per folder ('' is the root): images listed, how many are indexed now,
   *  and how many this scan could not read. */
  folderProgress(): Map<string, FolderCount> {
    const out = new Map<string, FolderCount>()
    // Until the plan, a folder is its count so far; nothing is known indexed.
    if (!this.planned) for (const [f, images] of this.listing.folders) out.set(f, { images, done: 0, failed: 0 })
    else for (const [f, [images, done, failed]] of this.perFolder) out.set(f, { images, done, failed })
    return out
  }

  /** The index as it stands: every device's records plus this scan's. */
  entries(): Map<string, QqiFile> {
    const out = new Map<string, QqiFile>()
    for (const [k, e] of this.merged) out.set(k, e.record)
    return out
  }

  /**
   * Lists, reads the index, plans and calibrates, then stops at 'planned' with
   * the cost stated (or 'done' when there is nothing to read). Writes nothing:
   * what it learned waits for run().
   */
  async prepare(): Promise<ScanProgress> {
    if (this.p.phase !== 'idle') throw new Error('qq scan: prepare() runs once')
    if (!(await this.lock())) {
      this.p.problems.push(ONE_SCAN_AT_A_TIME)
      return this.set('failed')
    }
    try {
      this.set('listing')
      this.listed = await listTree(this.o.root, (listed, folders, inFolder) => {
        this.p.listed = listed
        this.p.folders = folders
        this.p.listingIn = inFolder
        this.emit()
      }, () => this.stopping(), this.listing)
      if (this.stopping()) return this.finish('stopped')
      for (const u of this.listed.unlisted) this.p.problems.push(`The folder "${u.path}" could not be listed (${u.reason}); its images are not in this scan.`)

      this.set('indexing')
      const index = await readIndex(this.o.root)
      this.p.problems.push(...index.problems)
      this.p.indexBytes = index.bytes
      const kept = await this.readKept()
      if (this.stopping()) return this.finish('stopped')
      const segments = kept ? [...index.segments, kept] : index.segments
      this.merged = mergeSegments(segments)
      this.p.indexed = this.merged.size
      if (kept && this.saveTo === 'folder') {
        // Moved into the folder ahead of everything this scan learns. A record
        // an older parser wrote is left behind: the plan reads its file again.
        for (const w of winners(segments.flatMap(placeAll)).values()) {
          if (w.deviceId !== kept.deviceId || w.parserVersion < PARSER_VERSION) continue
          this.pending.push(w.record)
          this.keptRecords.add(w.record)
        }
      }
      // Nothing kept is needed: no write waits on dropping it.
      if (this.keptToDrop && !this.keptRecords.size) await this.dropKept()

      const plan = planScan(this.listed.files.keys(), this.merged)
      this.toRead = plan.toRead
      this.pending.push(...plan.records)
      for (const r of plan.records) this.apply(r)
      Object.assign(this.p, {
        adopted: plan.adopted, moved: plan.moves.length, gone: plan.gone.length, toRead: plan.toRead.length,
        unsaved: this.pending.length,
      })
      for (const path of this.listed.files.keys()) {
        const f = folderOf(path)
        const c = this.perFolder.get(f) ?? [0, 0, 0]
        c[0]++
        if (this.merged.has(pathKey(path))) c[1]++
        this.perFolder.set(f, c)
      }
      this.planned = true

      if (this.toRead.length) {
        this.set('calibrating')
        await this.readSome(Math.min(this.o.calibrate, this.toRead.length))
        if (this.stopping()) return this.finish('stopped')
      }
      this.estimate()
      if (this.cursor >= this.toRead.length && !this.pending.length) return this.finish('done')
      return this.set('planned')
    } catch (e) {
      // Stopped already: whatever failed after that is not this scan's.
      if (this.stopping()) return this.finish('stopped')
      this.p.problems.push(failureWords(e))
      return this.finish('failed')
    }
  }

  /** Reads what is left and saves as it goes. Resolves at 'done', 'paused' or
   *  'stopped'. Called again after a pause, it carries on where it stopped. */
  async run(): Promise<ScanProgress> {
    if (this.p.phase !== 'planned' && this.p.phase !== 'paused') throw new Error(`qq scan: run() from ${this.p.phase}`)
    this.halt = null
    this.set('reading')
    try {
      this.lastFlush = this.o.now()
      await this.flush(true) // the plan's moves and gones, and the calibration's reads
      await this.readSome(Infinity)
      await this.flush(true)
      if (this.stopping()) return this.finish('stopped')
      if (this.halt === 'pause') return this.set('paused')
      return this.finish(this.p.unsaved ? 'paused' : 'done')
    } catch (e) {
      this.p.problems.push(failureWords(e))
      return this.finish('failed')
    }
  }

  /** Finishes the reads in flight, saves, and stops at 'paused'. */
  pause(): void {
    if (this.p.phase === 'reading') { this.halt = 'pause'; this.set('pausing') }
  }

  /**
   * As pause, but the scan cannot be resumed. Once the user has said go, what
   * was read is still saved. At 'planned' they have not (sec 7a step 4: it
   * writes nothing before the user says go), so declining the cost discards
   * the calibration's reads and the plan, and writes nothing.
   */
  stop(): void {
    this.halt = 'stop'
    if (NOTHING_WRITTEN.has(this.p.phase)) {
      // At once, not when the step in flight answers: a stalled listing may
      // never answer, and Stop is what the stall watch recommends. Nothing
      // is written before Start, and prepare() checks for the stop after
      // every step, so the step's late answer changes nothing.
      this.pending = []
      this.p.unsaved = 0
      this.finish('stopped')
    } else if (this.p.phase === 'planned') {
      this.pending = []
      this.p.unsaved = 0
      this.finish('stopped')
    } else if (this.p.phase === 'paused') {
      void this.flush(true).finally(() => this.finish('stopped'))
    }
  }

  // ---

  /** A method, not a field test: tsc narrows `halt` across an await that may set it. */
  private stopping(): boolean { return this.halt === 'stop' }

  private async readSome(limit: number): Promise<void> {
    const end = Math.min(this.toRead.length, this.cursor + limit)
    const files = this.listed!.files
    const worker = async () => {
      while (!this.halt && this.cursor < end) {
        const path = this.toRead[this.cursor++]
        const t0 = this.o.now()
        try {
          const r = await readEntry(path, files.get(path)!, this.o.prefixBytes)
          this.readMs += this.o.now() - t0
          this.readsTimed++
          if (r.reads === 2) this.p.secondReads++
          this.pending.push(r.record)
          this.apply(r.record)
          const c = this.perFolder.get(folderOf(path))
          if (c) c[1]++
        } catch (e) {
          if (errorName(e) === 'NotAllowedError') {
            // Not read: put it back at the cursor, so the next run starts with
            // it. (Not cursor--: another reader may have taken the next path.)
            this.toRead.splice(this.cursor, 0, path)
            if (this.halt !== 'pause') {
              this.p.problems.push('This browser stopped allowing QuickQueue to read the folder, so the scan paused. Give access again to carry on.')
            }
            this.halt = 'pause'
            break
          }
          this.p.unreadable++
          const c = this.perFolder.get(folderOf(path))
          if (c) c[2]++
          this.p.problems.push(`"${path}" could not be read (${errorName(e) || 'unknown error'}); the next scan tries it again.`)
        }
        this.p.read++
        this.p.unsaved = this.pending.length
        if (this.p.phase === 'reading') await this.flush(false)
        this.emit()
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, this.o.concurrency) }, worker))
  }

  private async flush(force: boolean): Promise<void> {
    while (this.flushing) await this.flushing
    if (!this.pending.length) return
    if (!force && this.pending.length < this.o.flushRecords && this.o.now() - this.lastFlush < this.o.flushMs) return
    let batch = this.pending
    this.pending = []
    const mine = (async () => {
      try {
        for (;;) {
          try {
            await this.save(batch)
            break
          } catch (e) {
            if (this.saveTo === 'folder' && this.o.keeper && refusesWrites(e)) {
              // Keep it in this browser from here on. What the keeper already
              // holds stays there and is not written to it twice.
              this.saveTo = 'browser'
              this.own = null
              this.keptToDrop = false
              batch = batch.filter((r) => !this.keptRecords.has(r))
              this.p.problems.push(KEPT_IN_BROWSER)
              continue
            }
            throw e
          }
        }
        this.p.saved += batch.length
        // The first save into the folder carried the keeper's records: they
        // were first in line, and a failed batch goes back to the front.
        if (this.keptToDrop) await this.dropKept()
      } catch (e) {
        this.pending = batch.concat(this.pending)
        const said = saveFailureWords(e, this.saveTo)
        if (this.p.problems[this.p.problems.length - 1] !== said) this.p.problems.push(said)
      } finally {
        this.lastFlush = this.o.now()
        this.p.unsaved = this.pending.length
      }
    })()
    this.flushing = mine
    try { await mine } finally { if (this.flushing === mine) this.flushing = null }
  }

  private async save(batch: QqiRecord[]): Promise<void> {
    if (!batch.length) return
    if (!this.own || !this.own.usable) {
      this.own = this.saveTo === 'browser'
        ? await OwnSegment.open(keptSegmentFile(this.o.keeper!), this.keptDevice)
        : await OwnSegment.open(await folderSegmentFile(this.o.root, this.o.deviceId), this.o.deviceId)
      if (this.own.problem) this.p.problems.push(this.own.problem)
    }
    await this.own.append(batch, Math.floor(this.o.now() / 1000))
  }

  /** The keeper's segment, or null. Problems are said; none stops the scan. */
  private async readKept(): Promise<SegmentRead | null> {
    if (!this.o.keeper) return null
    let bytes: Uint8Array | null
    try {
      bytes = await this.o.keeper.read()
    } catch (e) {
      this.p.problems.push(`${KEPT_LABEL} could not be read (${errorName(e) || 'unknown error'}).`)
      return null
    }
    if (!bytes?.length) return null
    this.keptToDrop = this.saveTo === 'folder'
    const r = await readSegment(bytes)
    if (!r.ok) { this.p.problems.push(`${KEPT_LABEL} was skipped: ${r.reason}.`); return null }
    if (r.stopped) this.p.problems.push(`${KEPT_LABEL} was read up to byte ${r.goodLength} of ${bytes.length}: ${r.stopped}.`)
    return r
  }

  private async dropKept(): Promise<void> {
    this.keptToDrop = false
    try {
      await this.o.keeper!.drop()
    } catch (e) {
      this.p.problems.push(`${KEPT_LABEL} is now saved in the folder, but this browser's copy could not be removed (${errorName(e) || 'unknown error'}); the next scan moves it again.`)
    }
  }

  private apply(r: QqiRecord): void {
    const k = pathKey(r.path)
    if (r.kind === 'gone') { this.merged.delete(k); return }
    this.merged.set(k, { record: r, deviceId: this.o.deviceId, writtenAt: Math.floor(this.o.now() / 1000), parserVersion: PARSER_VERSION, seq: 0 })
  }

  private estimate(): void {
    const left = this.toRead.length - this.cursor
    this.p.addBytes = left * BYTES_PER_FILE
    this.p.etaSeconds = this.readsTimed
      ? Math.round((this.readMs / this.readsTimed / Math.max(1, this.o.concurrency)) * left / 1000)
      : null
  }

  private set(phase: ScanPhase): ScanProgress {
    this.p.phase = phase
    this.estimate()
    this.lastEmit = this.o.now()
    this.o.onProgress?.(this.progress())
    return this.progress()
  }

  private emit(): void {
    const now = this.o.now()
    if (now - this.lastEmit < 200) return
    this.lastEmit = now
    this.estimate()
    this.o.onProgress?.(this.progress())
  }

  private finish(phase: ScanPhase): ScanProgress {
    this.releaseLock?.()
    this.releaseLock = null
    return this.set(phase)
  }

  private lock(): Promise<boolean> {
    const locks = this.o.locks
    if (!locks) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      void locks.request('net.41chan.qq-scan', { ifAvailable: true }, (got) => {
        if (!got) { resolve(false); return }
        resolve(true)
        return new Promise<void>((release) => { this.releaseLock = release })
      })
    })
  }
}

function folderOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

function failureWords(e: unknown): string {
  const name = errorName(e)
  if (name === 'NotAllowedError') return 'This browser does not allow QuickQueue to read the folder now. Give access again, then scan.'
  if (name === 'NotFoundError') return 'The folder is not where it was: it may have been moved, renamed or deleted. Pick it again.'
  return `The scan stopped on an error (${name || String(e)}). What it read before that is kept.`
}

function refusesWrites(e: unknown): boolean {
  const name = errorName(e)
  return name === 'NotAllowedError' || name === 'NoModificationAllowedError' || name === 'SecurityError'
}

export const KEPT_IN_BROWSER =
  `QuickQueue may not write into this folder, so its index is kept in this browser instead, and other devices will scan it again. ` +
  `To save it into the folder (${INDEX_DIR}), Stop, press Scan again and allow editing.`

function saveFailureWords(e: unknown, where: 'folder' | 'browser'): string {
  const name = errorName(e)
  if (where === 'browser') {
    if (name === 'QuotaExceededError') return 'This browser has no room left to keep the index, so it stays in this tab and saving is tried again.'
    return `The index could not be kept in this browser (${name || String(e)}). It stays in this tab and saving is tried again.`
  }
  if (refusesWrites(e)) {
    return `QuickQueue may not write into this folder, so the index is kept in this tab only and other devices will scan again. Give QuickQueue write access to this folder to save it there (${INDEX_DIR}).`
  }
  if (name === 'QuotaExceededError') return 'The disk holding this folder is full, so the index could not be saved. It stays in this tab and is saved once there is room.'
  return `The index could not be saved into the folder (${name || String(e)}). It stays in this tab and saving is tried again.`
}
