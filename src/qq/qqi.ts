// The QuickQueue folder index segment, `.quickqueue/<device-id>.qqi`.
//
// The byte layout is canon's, not this file's: QQ_FOLDER_INDEX.md sec 3c in
// fourier-basis. A change here that the doc does not say is a bug in one of
// the two; change the doc first.
//
// What the index IS decides most of this code: a cache keyed by relative path,
// never a record of what exists. The folder listing says what is there; an
// entry only says "if this path is listed, here is what its file held". So any
// subset of entries is a valid index, and every failure here costs at most a
// Scan read of the files it would have spared. A reader never repairs a
// segment and never throws on one: what it cannot read it reports, and the
// panel says so (memory fail-loudly-no-fallbacks).
//
// One writer per file: each device writes only its own segment and reads
// everyone's. Nothing here touches the network.

import { crc32 } from '../client/identityStrip'

export const MAGIC = 'QQI1'
export const FRAME_VERSION = 1
/** Bumped whenever promptTags.ts changes what it finds in a file. */
export const PARSER_VERSION = 1
const HEADER_BYTES = 4 + 16

// --- records ---------------------------------------------------------------------

export interface QqiPrompt {
  /** The chunk key the prompt came from ("parameters", "prompt", ...). */
  generator: string
  /** The parser's three lists. Stored as sorted string ids, so they come back
   *  in table order, not prompt order: search needs the set, and the prompt's
   *  own order is in the file. */
  tags: string[]
  meta: string[]
  characters: string[]
}

export interface QqiFile {
  kind: 'file'
  /** Relative to the picked root, `/`-separated, exactly as the listing gave it. */
  path: string
  size: number
  /** File.lastModified, milliseconds. */
  mtime: number
  /** Present only once a device read the whole file (selection); a Scan reads headers. */
  md5?: Uint8Array
  /** Null: the file was read and holds no prompt, so no device reads it again. */
  prompt: QqiPrompt | null
  /** Checkpoint, LoRAs, sampler, seed... Empty until a parser for them is ported. */
  params: [string, string][]
}

/** "This device saw this path vanish": deleted, or moved and re-paired elsewhere. */
export interface QqiGone { kind: 'gone'; path: string }

export type QqiRecord = QqiFile | QqiGone

export interface QqiFrame {
  /** Unix seconds. A writer never lets it go backwards within its own segment. */
  writtenAt: number
  parserVersion: number
  records: QqiRecord[]
}

// --- device ids ------------------------------------------------------------------

const HEX_ID = /^[0-9a-f]{32}$/

/** A random id, made once per browser profile. It names nothing: no host, no user. */
export function newDeviceId(): string {
  return hex(crypto.getRandomValues(new Uint8Array(16)))
}

export function segmentName(deviceId: string): string {
  return `${deviceId}.qqi`
}

function hex(b: Uint8Array): string {
  let s = ''
  for (const x of b) s += x.toString(16).padStart(2, '0')
  return s
}

function unhex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16)
  return out
}

// --- varints and bytes -------------------------------------------------------------

class Out {
  private buf = new Uint8Array(1024)
  len = 0
  private room(n: number) {
    if (this.len + n <= this.buf.length) return
    let cap = this.buf.length * 2
    while (cap < this.len + n) cap *= 2
    const next = new Uint8Array(cap)
    next.set(this.buf.subarray(0, this.len))
    this.buf = next
  }
  /** Unsigned LEB128 by arithmetic, not bit operators: sizes and times pass 2^32. */
  uint(n: number) {
    if (!Number.isSafeInteger(n) || n < 0) throw new Error(`qqi: ${n} is not a non-negative safe integer`)
    this.room(8)
    while (n >= 0x80) {
      this.buf[this.len++] = (n % 0x80) | 0x80
      n = Math.floor(n / 0x80)
    }
    this.buf[this.len++] = n
  }
  bytes(b: Uint8Array) {
    this.room(b.length)
    this.buf.set(b, this.len)
    this.len += b.length
  }
  str(s: string) {
    const b = new TextEncoder().encode(s)
    this.uint(b.length)
    this.bytes(b)
  }
  done(): Uint8Array {
    return this.buf.slice(0, this.len)
  }
}

class BadFrame extends Error {}

class In {
  pos = 0
  private b: Uint8Array
  constructor(b: Uint8Array) { this.b = b }
  get left() { return this.b.length - this.pos }
  uint(): number {
    let n = 0
    let mul = 1
    for (;;) {
      if (this.pos >= this.b.length) throw new BadFrame('a number runs past the end of the frame')
      const x = this.b[this.pos++]
      n += (x & 0x7f) * mul
      if (!Number.isSafeInteger(n)) throw new BadFrame('a number is too large')
      if (x < 0x80) return n
      mul *= 0x80
    }
  }
  /** A count of items each at least `min` bytes long cannot exceed what is left. */
  count(min = 1): number {
    const n = this.uint()
    if (n * min > this.left) throw new BadFrame('a count is larger than the frame')
    return n
  }
  bytes(n: number): Uint8Array {
    if (n > this.left) throw new BadFrame('a field runs past the end of the frame')
    const out = this.b.subarray(this.pos, this.pos + n)
    this.pos += n
    return out
  }
  str(): string {
    return UTF8.decode(this.bytes(this.uint()))
  }
}

const UTF8 = new TextDecoder('utf-8', { fatal: true })

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

function u32le(b: Uint8Array, at: number): number {
  return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0
}

function put32le(b: Uint8Array, at: number, n: number) {
  b[at] = n & 0xff
  b[at + 1] = (n >>> 8) & 0xff
  b[at + 2] = (n >>> 16) & 0xff
  b[at + 3] = (n >>> 24) & 0xff
}

// --- paths -------------------------------------------------------------------------

function splitPath(path: string): [string, string] {
  if (!path || path.startsWith('/') || path.endsWith('/') || path.includes('//')) {
    throw new Error('qqi: a path must be relative, `/`-separated, with no empty part')
  }
  const cut = path.lastIndexOf('/')
  return cut < 0 ? ['', path] : [path.slice(0, cut), path.slice(cut + 1)]
}

/** The key two devices' names are compared by (a share may hand macOS decomposed names). */
export function pathKey(path: string): string {
  return path.normalize('NFC')
}

// --- writing -----------------------------------------------------------------------

/**
 * The owner's side of one segment. Its string and folder tables are cumulative
 * across the segment's frames, so a writer that resumes an existing file must
 * start from that file's tables: use `SegmentWriter.resume`.
 */
export class SegmentWriter {
  private strings = new Map<string, number>()
  private folders = new Map<string, number>()
  private lastWrittenAt = 0

  readonly deviceId: string

  private constructor(deviceId: string) {
    this.deviceId = deviceId
    if (!HEX_ID.test(deviceId)) throw new Error('qqi: a device id is 32 lowercase hex digits')
  }

  /** A new segment: write `header()` and then each frame after it. */
  static fresh(deviceId: string): SegmentWriter {
    return new SegmentWriter(deviceId)
  }

  /**
   * Carry on appending to a segment this device already wrote. Appending is
   * only safe after a read that reached the end: when the read stopped early
   * (`stopped` set), the owner rewrites the segment instead (truncate to
   * `goodLength`, or compact).
   */
  static resume(read: SegmentRead): SegmentWriter {
    const w = new SegmentWriter(read.deviceId)
    read.strings.forEach((s, i) => w.strings.set(s, i))
    read.folders.forEach((f, i) => w.folders.set(f, i))
    for (const f of read.frames) w.lastWrittenAt = Math.max(w.lastWrittenAt, f.writtenAt)
    return w
  }

  header(): Uint8Array {
    const out = new Uint8Array(HEADER_BYTES)
    out.set(new TextEncoder().encode(MAGIC), 0)
    out.set(unhex(this.deviceId), 4)
    return out
  }

  /**
   * One frame's bytes, ready to append. `writtenAt` is raised to the last
   * frame's when the clock has gone backwards, so within one segment a later
   * frame never sorts before an earlier one. The tables change only once the
   * frame is complete.
   */
  async frame(records: QqiRecord[], writtenAt: number, parserVersion = PARSER_VERSION): Promise<Uint8Array> {
    const at = Math.max(Math.floor(writtenAt), this.lastWrittenAt)
    const newStrings: string[] = []
    const newFolders: string[] = []
    const sid = (s: string) => {
      let id = this.strings.get(s)
      if (id === undefined) {
        const k = newStrings.indexOf(s)
        id = this.strings.size + (k < 0 ? newStrings.push(s) - 1 : k)
      }
      return id
    }
    const fid = (f: string) => {
      let id = this.folders.get(f)
      if (id === undefined) {
        const k = newFolders.indexOf(f)
        id = this.folders.size + (k < 0 ? newFolders.push(f) - 1 : k)
      }
      return id
    }

    const recs = new Out()
    recs.uint(records.length)
    for (const r of records) {
      const [folder, name] = splitPath(r.path)
      recs.uint(r.kind === 'file' ? 0 : 1)
      recs.uint(fid(folder))
      recs.str(name)
      if (r.kind === 'gone') continue
      if (r.md5 && r.md5.length !== 16) throw new Error('qqi: an MD5 is 16 bytes')
      recs.uint((r.md5 ? 1 : 0) | (r.prompt ? 0 : 2))
      recs.uint(r.size)
      recs.uint(r.mtime)
      if (r.md5) recs.bytes(r.md5)
      if (r.prompt) {
        recs.uint(sid(r.prompt.generator))
        for (const list of [r.prompt.tags, r.prompt.meta, r.prompt.characters]) {
          const ids = list.map(sid).sort((a, b) => a - b)
          recs.uint(ids.length)
          let prev = 0
          for (const id of ids) { recs.uint(id - prev); prev = id }
        }
      }
      recs.uint(r.params.length)
      for (const [k, v] of r.params) { recs.uint(sid(k)); recs.str(v) }
    }

    const body = new Out()
    body.uint(FRAME_VERSION)
    body.uint(parserVersion)
    body.uint(at)
    body.uint(newStrings.length)
    for (const s of newStrings) body.str(s)
    body.uint(newFolders.length)
    for (const f of newFolders) body.str(f)
    body.bytes(recs.done())

    const packed = await deflateRaw(body.done())
    const out = new Uint8Array(8 + packed.length)
    put32le(out, 0, packed.length)
    put32le(out, 4, crc32(packed))
    out.set(packed, 8)

    for (const s of newStrings) this.strings.set(s, this.strings.size)
    for (const f of newFolders) this.folders.set(f, this.folders.size)
    this.lastWrittenAt = at
    return out
  }
}

/** A whole segment in one go: header and frames. */
export async function encodeSegment(deviceId: string, frames: QqiFrame[]): Promise<Uint8Array> {
  const w = SegmentWriter.fresh(deviceId)
  const parts = [w.header()]
  for (const f of frames) parts.push(await w.frame(f.records, f.writtenAt, f.parserVersion))
  return concat(parts)
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

// --- reading -----------------------------------------------------------------------

export interface SegmentRead {
  ok: true
  deviceId: string
  frames: QqiFrame[]
  /** Bytes up to the end of the last frame that read whole. */
  goodLength: number
  /** Why the read ended before the end of the file, or null when it did not. */
  stopped: string | null
  strings: string[]
  folders: string[]
}

export interface SegmentRefused {
  ok: false
  /** Said to the user as it stands. */
  reason: string
}

/**
 * Read a segment. Never throws. A file that is not a segment, or whose header
 * names a different device than its file name, is refused whole; a frame that
 * is torn, fails its CRC or does not decode ends the read there, and every
 * frame before it stands.
 */
export async function readSegment(bytes: Uint8Array, fileName?: string): Promise<SegmentRead | SegmentRefused> {
  if (bytes.length < HEADER_BYTES || String.fromCharCode(...bytes.subarray(0, 4)) !== MAGIC) {
    return { ok: false, reason: 'not a QuickQueue index segment (no QQI1 header)' }
  }
  const deviceId = hex(bytes.subarray(4, HEADER_BYTES))
  if (fileName !== undefined && fileName !== segmentName(deviceId)) {
    return { ok: false, reason: `its header names device ${deviceId}, not its file name ${fileName}; a copied or renamed segment is skipped so no file gains a second writer` }
  }
  const strings: string[] = []
  const folders: string[] = []
  const frames: QqiFrame[] = []
  let at = HEADER_BYTES
  let stopped: string | null = null
  while (at < bytes.length) {
    if (at + 8 > bytes.length) { stopped = `torn frame header at byte ${at}`; break }
    const len = u32le(bytes, at)
    const crc = u32le(bytes, at + 4)
    if (at + 8 + len > bytes.length) { stopped = `frame at byte ${at} runs past the end of the file`; break }
    const packed = bytes.subarray(at + 8, at + 8 + len)
    if (crc32(packed) !== crc) { stopped = `frame at byte ${at} fails its CRC`; break }
    const body = await inflateRaw(packed)
    if (!body) { stopped = `frame at byte ${at} does not decompress`; break }
    const s0 = strings.length
    const f0 = folders.length
    try {
      frames.push(decodeFrame(body, strings, folders))
    } catch (e) {
      strings.length = s0
      folders.length = f0
      stopped = `frame at byte ${at}: ${e instanceof BadFrame || e instanceof TypeError ? e.message : String(e)}`
      break
    }
    at += 8 + len
  }
  return { ok: true, deviceId, frames, goodLength: at, stopped, strings, folders }
}

function decodeFrame(body: Uint8Array, strings: string[], folders: string[]): QqiFrame {
  const r = new In(body)
  const version = r.uint()
  if (version !== FRAME_VERSION) throw new BadFrame(`frame version ${version} is newer than this reader`)
  const parserVersion = r.uint()
  const writtenAt = r.uint()
  for (let n = r.count(); n > 0; n--) strings.push(r.str())
  for (let n = r.count(); n > 0; n--) folders.push(r.str())
  const str = (id: number) => {
    if (id >= strings.length) throw new BadFrame('a string id names no string')
    return strings[id]
  }
  const records: QqiRecord[] = []
  for (let n = r.count(3); n > 0; n--) {
    const kind = r.uint()
    if (kind > 1) throw new BadFrame(`record kind ${kind} is unknown`)
    const folder = r.uint()
    if (folder >= folders.length) throw new BadFrame('a folder id names no folder')
    const name = r.str()
    const path = folders[folder] ? `${folders[folder]}/${name}` : name
    if (kind === 1) { records.push({ kind: 'gone', path }); continue }
    const flags = r.uint()
    if (flags > 3) throw new BadFrame(`record flags ${flags} are unknown`)
    const size = r.uint()
    const mtime = r.uint()
    const md5 = flags & 1 ? r.bytes(16).slice() : undefined
    let prompt: QqiPrompt | null = null
    if (!(flags & 2)) {
      const generator = str(r.uint())
      const lists: string[][] = []
      for (let l = 0; l < 3; l++) {
        const out: string[] = []
        let id = 0
        for (let k = r.count(); k > 0; k--) { id += r.uint(); out.push(str(id)) }
        lists.push(out)
      }
      prompt = { generator, tags: lists[0], meta: lists[1], characters: lists[2] }
    }
    const params: [string, string][] = []
    for (let k = r.count(2); k > 0; k--) params.push([str(r.uint()), r.str()])
    const rec: QqiFile = { kind: 'file', path, size, mtime, prompt, params }
    if (md5) rec.md5 = md5
    records.push(rec)
  }
  if (r.left) throw new BadFrame(`${r.left} bytes follow the last record`)
  return { writtenAt, parserVersion, records }
}

// --- merging -----------------------------------------------------------------------

/** One record with the facts that order it against every other segment's. */
export interface Placed {
  record: QqiRecord
  deviceId: string
  writtenAt: number
  parserVersion: number
  /** Position within its own segment; orders records of one device. */
  seq: number
}

/** Newest written-at wins; on a tie the higher device id; within a device, the later record. */
export function newer(a: Placed, b: Placed): boolean {
  if (a.writtenAt !== b.writtenAt) return a.writtenAt > b.writtenAt
  if (a.deviceId !== b.deviceId) return a.deviceId > b.deviceId
  return a.seq > b.seq
}

export function placeAll(seg: { deviceId: string; frames: QqiFrame[] }): Placed[] {
  const out: Placed[] = []
  let seq = 0
  for (const f of seg.frames) {
    for (const record of f.records) {
      out.push({ record, deviceId: seg.deviceId, writtenAt: f.writtenAt, parserVersion: f.parserVersion, seq: seq++ })
    }
  }
  return out
}

/** The winning record per path key, gone records included. */
function winners(placed: Iterable<Placed>): Map<string, Placed> {
  const best = new Map<string, Placed>()
  for (const p of placed) {
    const k = pathKey(p.record.path)
    const cur = best.get(k)
    if (!cur || newer(p, cur)) best.set(k, p)
  }
  return best
}

/**
 * Every segment's view merged: the entry search reads for each path, keyed by
 * `pathKey`. A path whose newest record is a gone record has no entry.
 */
export function mergeSegments(segs: { deviceId: string; frames: QqiFrame[] }[]): Map<string, Placed & { record: QqiFile }> {
  const out = new Map<string, Placed & { record: QqiFile }>()
  for (const [k, p] of winners(segs.flatMap(placeAll))) {
    if (p.record.kind === 'file') out.set(k, p as Placed & { record: QqiFile })
  }
  return out
}

/** Same content: what a reader would be told about the path, time and device aside. */
export function sameContent(a: QqiRecord, b: QqiRecord): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'gone' || b.kind === 'gone') return true
  if (a.size !== b.size || a.mtime !== b.mtime) return false
  if (!!a.md5 !== !!b.md5 || (a.md5 && b.md5 && hex(a.md5) !== hex(b.md5))) return false
  const set = (l: string[]) => JSON.stringify([...l].sort())
  if (!!a.prompt !== !!b.prompt) return false
  if (a.prompt && b.prompt) {
    if (a.prompt.generator !== b.prompt.generator) return false
    if (set(a.prompt.tags) !== set(b.prompt.tags)) return false
    if (set(a.prompt.meta) !== set(b.prompt.meta)) return false
    if (set(a.prompt.characters) !== set(b.prompt.characters)) return false
  }
  return JSON.stringify(a.params) === JSON.stringify(b.params)
}

// --- compaction --------------------------------------------------------------------

/**
 * The frames a device rewrites its OWN segment as. Never another device's:
 * that would make two writers of one file. `listed` is the set of `pathKey`s
 * in the folder now.
 *
 * Only the device's newest record per path is a candidate, and it is dropped
 * when the merge does not need it:
 * - a file record for a path no longer listed;
 * - a gone record no other segment holds any record for (it answers nothing);
 * - a record the merge does not show and whose content differs from what it
 *   does show (superseded);
 * - a record whose content equals the record the merge would show without it,
 *   held by a device with a LOWER id. The lowest id keeps its copy, so two
 *   devices compacting at once against the same segments never both drop the
 *   only copy: for every listed path, merging the compacted segments shows
 *   what merging the originals did (checks/qqi.check.ts tests exactly that).
 *
 * Kept records stay in frames carrying their ORIGINAL written-at and parser
 * version: restamping them would change which device's record wins.
 */
export function compactFrames(
  own: { deviceId: string; frames: QqiFrame[] },
  others: { deviceId: string; frames: QqiFrame[] }[],
  listed: ReadonlySet<string>,
): QqiFrame[] {
  const mine = winners(placeAll(own))
  const theirsAll = others.filter((s) => s.deviceId !== own.deviceId).flatMap(placeAll)
  const theirs = winners(theirsAll)

  const kept: Placed[] = []
  for (const [k, r] of mine) {
    const o = theirs.get(k)
    if (r.record.kind === 'file' && !listed.has(k)) continue
    if (r.record.kind === 'gone' && !o) continue
    if (o) {
      const shown = newer(o, r) ? o : r
      if (shown !== r) {
        if (!sameContent(shown.record, r.record)) continue
        if (shown.deviceId < own.deviceId) continue
      } else if (sameContent(o.record, r.record) && o.deviceId < own.deviceId) {
        continue
      }
    }
    kept.push(r)
  }

  kept.sort((a, b) => a.seq - b.seq)
  const frames: QqiFrame[] = []
  for (const p of kept) {
    const last = frames[frames.length - 1]
    if (last && last.writtenAt === p.writtenAt && last.parserVersion === p.parserVersion) last.records.push(p.record)
    else frames.push({ writtenAt: p.writtenAt, parserVersion: p.parserVersion, records: [p.record] })
  }
  return frames
}
