import {
  AVIF_BRANDS,
  EXIF_PROMPT_FIELDS,
  GIF_APPS,
  GIF_APP_NAMES,
  HEIC_BRANDS,
  ISO_CONTAINERS,
  ISO_ITEM_NAMES,
  ISO_ITEM_TYPES,
  ISO_LEAVES,
  ISO_TIMED,
  JPEG_APP_NAMES,
  JPEG_CODEC,
  NONE,
  PNG_KEEP,
  RAW_PROFILE,
  WEBP_IMAGE,
  decodeUserComment,
  hasGenerationMarkers,
  pngContext,
  pngStrength,
  promptStrength,
} from '../canon-image-metadata.js'

// ---------------------------------------------------------------------------
// NOTHING THAT IDENTIFIES THE POSTER LEAVES THIS DEVICE (QuickQueue M1, tc.151).
//
// Operator ruling 2026-11-01: metadata that identifies the IMAGE -- its prompt,
// its generation settings -- may stay; metadata that identifies the USER --
// location, device, system settings, timestamps -- is stripped AND discarded.
// The tunnel already strips on ingest, but Synapse keeps whatever it is handed
// before the tunnel ever sees it, and an encrypted room is never seen by the
// tunnel at all. So the client strips before the bytes leave: before an
// upload, before encryption.
//
// It is an ALLOWLIST. What is left of a file is what its picture needs to be
// drawn right, plus the generation carriers the tunnel tags from and files
// privately for the creator:
//   PNG   the render chunks (canon PNG_KEEP), and a text chunk only when the
//         canon classifier says it is generation data
//   JPEG  the codec's segments, a JFIF header with no thumbnail and no
//         density, the ICC profile, Adobe's colour segment, and a comment
//         carrying a generator's markers
//   WebP  bitstreams, alpha, animation, the ICC profile
//   GIF   images, graphic control, loop count, ICC, and a comment holding a
//         prompt
//   AVIF  the boxes that decode, lay out or colour the picture; every item
//         that is not a picture (Exif, XMP) removed; times zeroed
//   and wherever EXIF can live, a NEW block holding only Orientation (2-8)
//   and the three fields a generator writes its prompt into (UserComment,
//   ImageDescription, XPComment) when they hold one.
// Everything else goes, named or not: GPS, make, model and serial, times,
// software, owner, XMP, IPTC, C2PA, thumbnails, depth and gain maps, and
// whatever follows the image's end.
//
// What goes is kept nowhere. `dropped` names KINDS of thing ("jpeg:APP1 XMP",
// "png:tIME"), never a value, so it is safe to log.
//
// Known losses, on purpose: a prompt held only in XMP (Midjourney's JPEG and
// WebP, Draw Things) or in a "Raw profile" chunk goes with the rest, because
// both carry the camera and the clock beside the prompt and rebuilding XMP is
// a second XML writer to get right. Pixels are never touched.
//
// Refused, with the reason and the fix told to the poster: HEIC (most
// browsers cannot draw it), TIFF and any format not named above, and a file
// that does not walk to its end (nothing past a break can be vouched for).
//
// The facts -- what a prompt looks like, what a picture needs -- are canon
// (src/canon-image-metadata.js, shared with fourier-tunnel). This file only
// walks containers. Pure: no DOM, so the check suite drives it directly.
// ---------------------------------------------------------------------------

export interface IdentityRefusalReason {
  why: string
  fix: string
}

export interface StripResult {
  bytes: Uint8Array
  // Kinds of thing removed, sorted; never their content.
  dropped: string[]
  changed: boolean
  refusal?: IdentityRefusalReason
}

const RESAVE = "save it again (any editor's export, or a screenshot, will do) and post that"
const CONVERT = 'save it as PNG, JPEG, WebP, GIF or AVIF and post that'

const latin1 = (b: Uint8Array, from: number, to: number) => {
  let s = ''
  for (let k = from; k < to && k < b.length; k++) s += String.fromCharCode(b[k])
  return s
}
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff)
const startsWith = (b: Uint8Array, at: number, s: string) => latin1(b, at, at + s.length) === s
// A four-character code read out of a file, made safe to log.
const fourcc = (s: string) => s.replace(/[^\x20-\x7e]/g, '?').trim()
const utf8 = (b: Uint8Array) => new TextDecoder('utf-8').decode(b)

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0
  for (const p of parts) n += p.length
  const out = new Uint8Array(n)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false
  return true
}

const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3]
const u16be = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1]
const u32le = (b: Uint8Array, at: number) => b[at] + (b[at + 1] << 8) + (b[at + 2] << 16) + ((b[at + 3] << 24) >>> 0)
function put32be(b: Uint8Array, at: number, v: number) {
  b[at] = (v >>> 24) & 0xff
  b[at + 1] = (v >>> 16) & 0xff
  b[at + 2] = (v >>> 8) & 0xff
  b[at + 3] = v & 0xff
}

function refused(bytes: Uint8Array, why: string, fix: string = RESAVE): StripResult {
  return { bytes, dropped: [], changed: false, refusal: { why, fix } }
}

function result(input: Uint8Array, out: Uint8Array, dropped: Set<string>): StripResult {
  const changed = !equal(input, out)
  return { bytes: changed ? out : input, dropped: [...dropped].sort(), changed }
}

// --- EXIF: Orientation and the prompt, nothing else ----------------------------

const TAG_ORIENTATION = 0x0112
const TAG_IMAGE_DESCRIPTION = 0x010e
const TAG_XP_COMMENT = 0x9c9c
const TAG_EXIF_IFD = 0x8769
const TAG_GPS_IFD = 0x8825
const TAG_USER_COMMENT = 0x9286
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 }
const EXIF_HEADER = 'Exif\0\0'

interface ExifField {
  tag: number
  type: number
  count: number
  value: Uint8Array
}

// One directory of a TIFF structure, bounds-checked at every step. null when
// the structure does not hold together.
function readIfd(t: Uint8Array, at: number, be: boolean): ExifField[] | null {
  const u16 = (o: number) => (be ? u16be(t, o) : t[o] | (t[o + 1] << 8))
  const u32 = (o: number) => (be ? u32be(t, o) : u32le(t, o))
  if (at + 2 > t.length) return null
  const n = u16(at)
  if (at + 2 + 12 * n > t.length) return null
  const out: ExifField[] = []
  for (let k = 0; k < n; k++) {
    const e = at + 2 + 12 * k
    const tag = u16(e)
    const type = u16(e + 2)
    const count = u32(e + 4)
    const size = (TYPE_SIZE[type] ?? 0) * count
    if (!TYPE_SIZE[type] || size > t.length) {
      out.push({ tag, type, count, value: new Uint8Array(0) })
      continue
    }
    const off = size <= 4 ? e + 8 : u32(e + 8)
    if (off + size > t.length) return null
    out.push({ tag, type, count, value: t.subarray(off, off + size) })
  }
  return out
}

const stripNul = (s: string) => s.replace(/\0+$/, '')

// The prompt text a field holds, for the canon classifier.
function fieldText(f: ExifField): string {
  if (f.tag === TAG_USER_COMMENT) return decodeUserComment(f.value)
  if (f.tag === TAG_XP_COMMENT) return stripNul(new TextDecoder('utf-16le').decode(f.value.subarray(0, f.value.length & ~1)))
  return stripNul(utf8(f.value))
}

const FIELD_NAME: Record<number, string> = {
  [TAG_USER_COMMENT]: 'UserComment',
  [TAG_IMAGE_DESCRIPTION]: 'ImageDescription',
  [TAG_XP_COMMENT]: 'XPComment',
}

function keepsPrompt(f: ExifField | undefined, type: number): f is ExifField {
  if (!f || f.type !== type || f.value.length === 0) return false
  if (!EXIF_PROMPT_FIELDS.has(FIELD_NAME[f.tag])) return false
  return promptStrength(fieldText(f)) > NONE
}

// A TIFF structure: IFD0 at 8, an Exif directory after it when there is one,
// then the values too long to sit in their entries. Written in `be` order.
function writeTiff(ifd0: ExifField[], exif: ExifField[], be: boolean): Uint8Array {
  const dirSize = (n: number) => 2 + 12 * n + 4
  const ifd0At = 8
  const exifAt = ifd0At + dirSize(ifd0.length + (exif.length ? 1 : 0))
  let dataAt = exifAt + (exif.length ? dirSize(exif.length) : 0)
  const head = new Uint8Array(dataAt)
  const dv = new DataView(head.buffer)
  const le = !be
  head.set(ascii(be ? 'MM' : 'II'), 0)
  dv.setUint16(2, 42, le)
  dv.setUint32(4, ifd0At, le)
  const data: Uint8Array[] = []
  const writeDir = (at: number, fields: ExifField[]) => {
    dv.setUint16(at, fields.length, le)
    fields.forEach((f, k) => {
      const e = at + 2 + 12 * k
      dv.setUint16(e, f.tag, le)
      dv.setUint16(e + 2, f.type, le)
      dv.setUint32(e + 4, f.count, le)
      if (f.value.length <= 4) {
        head.set(f.value, e + 8)
      } else {
        dv.setUint32(e + 8, dataAt, le)
        data.push(f.value)
        dataAt += f.value.length
        if (f.value.length & 1) {
          data.push(new Uint8Array(1))
          dataAt += 1
        }
      }
    })
    dv.setUint32(at + 2 + 12 * fields.length, 0, le)
  }
  const pointer: ExifField[] = []
  if (exif.length) {
    const v = new Uint8Array(4)
    new DataView(v.buffer).setUint32(0, exifAt, le)
    pointer.push({ tag: TAG_EXIF_IFD, type: 4, count: 1, value: v })
  }
  writeDir(ifd0At, [...ifd0, ...pointer].sort((a, b) => a.tag - b.tag))
  if (exif.length) writeDir(exifAt, exif)
  return concat([head, ...data])
}

// The EXIF block that replaces `t` (a TIFF structure), or null for none,
// noting what went under `where`.
export function keepExif(t: Uint8Array, where: string, dropped: Set<string>): Uint8Array | null {
  const order = latin1(t, 0, 2)
  const be = order === 'MM'
  if (t.length < 8 || (order !== 'MM' && order !== 'II')) {
    if (t.length) dropped.add(`${where} that does not read`)
    return null
  }
  const ifdAt = be ? u32be(t, 4) : u32le(t, 4)
  const ifd0 = readIfd(t, ifdAt, be) ?? []
  const keep0: ExifField[] = []
  const keepE: ExifField[] = []
  const orientation = ifd0.find((f) => f.tag === TAG_ORIENTATION)
  if (orientation && orientation.type === 3 && orientation.count === 1) {
    const v = be ? u16be(orientation.value, 0) : orientation.value[0] | (orientation.value[1] << 8)
    if (v >= 2 && v <= 8) keep0.push(orientation)
  }
  const description = ifd0.find((f) => f.tag === TAG_IMAGE_DESCRIPTION)
  if (keepsPrompt(description, 2)) keep0.push(description)
  const xp = ifd0.find((f) => f.tag === TAG_XP_COMMENT)
  if (keepsPrompt(xp, 1)) keep0.push(xp)
  const exifPtr = ifd0.find((f) => f.tag === TAG_EXIF_IFD && f.value.length === 4)
  if (exifPtr) {
    const at = be ? u32be(exifPtr.value, 0) : u32le(exifPtr.value, 0)
    const sub = readIfd(t, at, be) ?? []
    const comment = sub.find((f) => f.tag === TAG_USER_COMMENT)
    if (keepsPrompt(comment, 7)) keepE.push(comment)
  }
  if (ifd0.some((f) => f.tag === TAG_GPS_IFD)) dropped.add(`${where} GPS`)
  if (!keep0.length && !keepE.length) {
    dropped.add(`${where} fields other than Orientation and the prompt`)
    return null
  }
  const out = writeTiff(keep0, keepE, be)
  if (!equal(out, t)) dropped.add(`${where} fields other than Orientation and the prompt`)
  return out
}

// --- PNG -----------------------------------------------------------------------

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10]

let crcTable: Uint32Array | null = null
export function crc32(...parts: Uint8Array[]): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (const p of parts) for (let k = 0; k < p.length; k++) c = crcTable[(c ^ p[k]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  put32be(out, 0, data.length)
  out.set(ascii(type), 4)
  out.set(data, 8)
  put32be(out, 8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

async function inflate(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

// A text chunk's keyword and text; text is null when it does not decode.
async function readPngText(type: string, data: Uint8Array): Promise<{ keyword: string; text: string | null }> {
  const nul = data.indexOf(0)
  if (nul < 0) return { keyword: latin1(data, 0, data.length), text: null }
  const keyword = latin1(data, 0, nul)
  if (type === 'tEXt') return { keyword, text: latin1(data, nul + 1, data.length) }
  if (type === 'zTXt') {
    const body = await inflate(data.subarray(nul + 2))
    return { keyword, text: body ? latin1(body, 0, body.length) : null }
  }
  // iTXt: compression flag, method, language tag NUL, translated keyword NUL, text.
  const compressed = data[nul + 1] === 1
  const lang = data.indexOf(0, nul + 3)
  const trans = lang < 0 ? -1 : data.indexOf(0, lang + 1)
  if (trans < 0) return { keyword, text: null }
  const raw = data.subarray(trans + 1)
  const body = compressed ? await inflate(raw) : raw
  return { keyword, text: body ? utf8(body) : null }
}

const PNG_TEXT = new Set(['tEXt', 'zTXt', 'iTXt'])

async function stripPng(buf: Uint8Array): Promise<StripResult> {
  interface Chunk { type: string; start: number; end: number; data: Uint8Array }
  const chunks: Chunk[] = []
  let off = 8
  let ended = false
  while (off + 12 <= buf.length) {
    const len = u32be(buf, off)
    const type = latin1(buf, off + 4, off + 8)
    const end = off + 12 + len
    if (end > buf.length || !/^[A-Za-z]{4}$/.test(type)) break
    chunks.push({ type, start: off, end, data: buf.subarray(off + 8, end - 4) })
    off = end
    if (type === 'IEND') {
      ended = true
      break
    }
  }
  if (!ended) return refused(buf, "the PNG's chunks do not walk to its end")

  const texts = new Map<Chunk, { keyword: string; text: string | null }>()
  for (const c of chunks) if (PNG_TEXT.has(c.type)) texts.set(c, await readPngText(c.type, c.data))
  const ctx = pngContext([...texts.values()])

  const parts: Uint8Array[] = [buf.subarray(0, 8)]
  const dropped = new Set<string>()
  for (const c of chunks) {
    const t = texts.get(c)
    if (PNG_KEEP.has(c.type)) {
      parts.push(buf.subarray(c.start, c.end))
    } else if (t) {
      if (!RAW_PROFILE.test(t.keyword) && pngStrength(t.keyword, t.text, ctx) > NONE) parts.push(buf.subarray(c.start, c.end))
      else dropped.add(`png:${c.type}`)
    } else if (c.type === 'eXIf') {
      const body = startsWith(c.data, 0, EXIF_HEADER) ? c.data.subarray(6) : c.data
      const exif = keepExif(body, 'png:eXIf', dropped)
      if (exif) parts.push(pngChunk('eXIf', exif))
    } else if (!(c.type.charCodeAt(0) & 0x20)) {
      // A critical chunk this does not know: a decoder that does not know it
      // must not draw the image, so dropping it would post a different picture.
      return refused(buf, `the PNG holds a part ("${c.type}") Technetium cannot vouch for`)
    } else {
      dropped.add(`png:${c.type}`)
    }
  }
  if (off < buf.length) dropped.add('png:bytes after the end')
  return result(buf, concat(parts), dropped)
}

// --- JPEG ----------------------------------------------------------------------

function segment(marker: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length)
  out[0] = 0xff
  out[1] = marker
  out[2] = ((payload.length + 2) >> 8) & 0xff
  out[3] = (payload.length + 2) & 0xff
  out.set(payload, 4)
  return out
}

// JFIF as decoders need it: the version, square pixels, no density, no thumbnail.
function plainJfif(payload: Uint8Array): Uint8Array {
  return segment(0xe0, concat([ascii('JFIF\0'), payload.subarray(5, 7), Uint8Array.of(0, 0, 1, 0, 1, 0, 0)]))
}

function stripJpeg(buf: Uint8Array): StripResult {
  const parts: Uint8Array[] = [buf.subarray(0, 2)]
  const dropped = new Set<string>()
  let i = 2
  let ended = false
  let exifSeen = false
  while (i < buf.length) {
    if (buf[i] !== 0xff) return refused(buf, "the JPEG's parts do not walk")
    const m = buf[i + 1]
    if (m === 0xff) {
      i += 1
      continue
    }
    if (m === 0xd9) {
      parts.push(buf.subarray(i, i + 2))
      i += 2
      ended = true
      break
    }
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) {
      parts.push(buf.subarray(i, i + 2))
      i += 2
      continue
    }
    if (i + 4 > buf.length) break
    const end = i + 2 + u16be(buf, i + 2)
    if (end < i + 4 || end > buf.length) return refused(buf, 'a part of the JPEG runs past the end of the file')
    const payload = buf.subarray(i + 4, end)
    if (JPEG_CODEC.has(m)) {
      parts.push(buf.subarray(i, end))
    } else if (m === 0xe0 && startsWith(payload, 0, 'JFIF\0') && payload.length >= 14) {
      const jfif = plainJfif(payload)
      if (!equal(jfif, buf.subarray(i, end))) dropped.add('jpeg:JFIF density or thumbnail')
      parts.push(jfif)
    } else if (m === 0xe1 && startsWith(payload, 0, EXIF_HEADER) && !exifSeen) {
      exifSeen = true
      const exif = keepExif(payload.subarray(6), 'jpeg:Exif', dropped)
      if (exif) parts.push(segment(0xe1, concat([ascii(EXIF_HEADER), exif])))
    } else if ((m === 0xe2 && startsWith(payload, 0, 'ICC_PROFILE\0')) || (m === 0xee && startsWith(payload, 0, 'Adobe'))) {
      parts.push(buf.subarray(i, end))
    } else if (m >= 0xe0 && m <= 0xef) {
      const known = JPEG_APP_NAMES.find(([id]) => startsWith(payload, 0, id))
      dropped.add(`jpeg:APP${m - 0xe0}${known ? ` ${known[1]}` : ''}`)
    } else if (m === 0xfe) {
      // A comment: kept only when it carries a generator's own markers, the
      // rule the tunnel takes COM by. "Created with GIMP" goes.
      if (hasGenerationMarkers(utf8(payload))) parts.push(buf.subarray(i, end))
      else dropped.add('jpeg:COM')
    } else {
      return refused(buf, `the JPEG holds a part (0xFF${m.toString(16).toUpperCase()}) Technetium cannot vouch for`)
    }
    i = end
    if (m === 0xda) {
      // The scan's entropy-coded data runs to the next marker that is neither
      // a stuffed 0xFF00 nor a restart.
      let j = i
      while (j + 1 < buf.length && !(buf[j] === 0xff && buf[j + 1] !== 0 && (buf[j + 1] < 0xd0 || buf[j + 1] > 0xd7))) j++
      if (j + 1 >= buf.length) j = buf.length
      parts.push(buf.subarray(i, j))
      i = j
    }
  }
  if (!ended) return refused(buf, 'the JPEG does not reach its end')
  // After the end: a phone's second picture (depth map, gain map), anything.
  if (i < buf.length) dropped.add('jpeg:bytes after the end')
  return result(buf, concat(parts), dropped)
}

// --- WebP ----------------------------------------------------------------------

const VP8X_ICC = 0x20
const VP8X_ALPHA = 0x10
const VP8X_EXIF = 0x08
const VP8X_ANIMATION = 0x02

function riffChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + data.length + (data.length & 1))
  out.set(ascii(type), 0)
  new DataView(out.buffer).setUint32(4, data.length, true)
  out.set(data, 8)
  return out
}

function riffChunks(buf: Uint8Array, start: number, end: number): { type: string; data: Uint8Array }[] | null {
  const out: { type: string; data: Uint8Array }[] = []
  let i = start
  while (i + 8 <= end) {
    const size = u32le(buf, i + 4)
    if (i + 8 + size > end) return null
    out.push({ type: latin1(buf, i, i + 4), data: buf.subarray(i + 8, i + 8 + size) })
    i += 8 + size + (size & 1)
  }
  return out
}

function stripWebp(buf: Uint8Array): StripResult {
  const riffEnd = Math.min(8 + u32le(buf, 4), buf.length)
  const chunks = riffChunks(buf, 12, riffEnd)
  if (!chunks || !chunks.length) return refused(buf, "the WebP's parts do not walk")
  const dropped = new Set<string>()
  const extended = chunks[0].type === 'VP8X' && chunks[0].data.length >= 10
  const kept: Uint8Array[] = []
  let icc = false
  let exif = false
  for (const c of chunks.slice(extended ? 1 : 0)) {
    if (WEBP_IMAGE.has(c.type) || (extended && c.type === 'ANIM')) {
      kept.push(riffChunk(c.type, c.data))
    } else if (extended && c.type === 'ICCP' && !icc) {
      icc = true
      kept.push(riffChunk(c.type, c.data))
    } else if (extended && c.type === 'ANMF' && c.data.length >= 16) {
      // A frame: its 16-byte header, then its own chunks, of which only the
      // picture and its alpha are kept.
      const inner = riffChunks(c.data, 16, c.data.length)
      if (!inner) return refused(buf, "a frame of the WebP's animation does not walk")
      for (const f of inner) if (!WEBP_IMAGE.has(f.type)) dropped.add(`webp:${fourcc(f.type)} in a frame`)
      kept.push(riffChunk('ANMF', concat([c.data.subarray(0, 16), ...inner.filter((f) => WEBP_IMAGE.has(f.type)).map((f) => riffChunk(f.type, f.data))])))
    } else if (extended && c.type === 'EXIF' && !exif) {
      const t = keepExif(startsWith(c.data, 0, EXIF_HEADER) ? c.data.subarray(6) : c.data, 'webp:EXIF', dropped)
      if (t) {
        exif = true
        kept.push(riffChunk('EXIF', t))
      }
    } else {
      dropped.add(`webp:${fourcc(c.type)}`)
    }
  }
  if (riffEnd < buf.length) dropped.add('webp:bytes after the end')
  const head: Uint8Array[] = []
  if (extended) {
    // VP8X says which optional chunks follow; it is rewritten to say what is
    // left, its reserved bytes zeroed.
    const vp8x = Uint8Array.from(chunks[0].data)
    vp8x[0] = (vp8x[0] & (VP8X_ALPHA | VP8X_ANIMATION)) | (icc ? VP8X_ICC : 0) | (exif ? VP8X_EXIF : 0)
    vp8x.fill(0, 1, 4)
    head.push(riffChunk('VP8X', vp8x))
  }
  const body = concat([ascii('WEBP'), ...head, ...kept])
  const riff = new Uint8Array(8)
  riff.set(ascii('RIFF'), 0)
  new DataView(riff.buffer).setUint32(4, body.length, true)
  return result(buf, concat([riff, body]), dropped)
}

// --- GIF -----------------------------------------------------------------------

function pastSubBlocks(buf: Uint8Array, p: number): number {
  while (p < buf.length) {
    if (buf[p] === 0) return p + 1
    p += 1 + buf[p]
  }
  return -1
}

function subBlockText(buf: Uint8Array, p: number, end: number): string {
  const parts: Uint8Array[] = []
  while (p < end - 1 && buf[p] !== 0) {
    parts.push(buf.subarray(p + 1, p + 1 + buf[p]))
    p += 1 + buf[p]
  }
  return utf8(concat(parts))
}

function stripGif(buf: Uint8Array): StripResult {
  let i = 13
  if (buf[10] & 0x80) i += 3 * (1 << ((buf[10] & 7) + 1))
  const parts: Uint8Array[] = [buf.subarray(0, i)]
  const dropped = new Set<string>()
  let ended = false
  while (i < buf.length) {
    const b = buf[i]
    if (b === 0x3b) {
      parts.push(buf.subarray(i, i + 1))
      i += 1
      ended = true
      break
    }
    let end = -1
    if (b === 0x2c && i + 10 <= buf.length) {
      let p = i + 10
      if (buf[i + 9] & 0x80) p += 3 * (1 << ((buf[i + 9] & 7) + 1))
      end = pastSubBlocks(buf, p + 1)
      if (end > 0) parts.push(buf.subarray(i, end))
    } else if (b === 0x21 && i + 2 <= buf.length) {
      const kind = buf[i + 1]
      end = pastSubBlocks(buf, i + 2)
      const app = kind === 0xff && buf[i + 2] === 11 ? latin1(buf, i + 3, i + 14) : null
      if (end > 0 && (kind === 0xf9 || (app !== null && GIF_APPS.has(app)))) parts.push(buf.subarray(i, end))
      else if (end > 0 && kind === 0xfe && promptStrength(subBlockText(buf, i + 2, end)) > NONE) parts.push(buf.subarray(i, end))
      else if (kind === 0xfe) dropped.add('gif:comment')
      else if (kind === 0x01) dropped.add('gif:plain text')
      else if (app !== null) dropped.add(`gif:application extension${GIF_APP_NAMES.has(app) ? ` ${GIF_APP_NAMES.get(app)}` : ''}`)
      else dropped.add(`gif:extension 0x${kind.toString(16)}`)
    }
    if (!(end > 0)) return refused(buf, "the GIF's parts do not walk")
    i = end
  }
  if (!ended) return refused(buf, 'the GIF does not reach its end')
  if (i < buf.length) dropped.add('gif:bytes after the end')
  return result(buf, concat(parts), dropped)
}

// --- BMP -----------------------------------------------------------------------

function stripBmp(buf: Uint8Array): StripResult {
  const size = u32le(buf, 2)
  if (size < 26 || size > buf.length) return refused(buf, "the BMP's declared size does not match the file")
  return size === buf.length ? result(buf, buf, new Set()) : result(buf, buf.slice(0, size), new Set(['bmp:bytes after the end']))
}

// --- AVIF ----------------------------------------------------------------------
//
// Blanked IN PLACE, so no offset anywhere in the file moves: a box not on the
// list becomes `free` with its contents zeroed; movie, track and media times
// are zeroed; an item that is not a picture (Exif, XMP) is taken out of the
// item tables, the tables are rewritten shorter, and the top-level `meta` is
// padded back to its old size with a `free` box at its end; the removed items'
// bytes are zeroed where they lie.

interface IsoBox {
  type: string
  start: number
  body: number
  end: number
}

function isoBox(buf: Uint8Array, at: number, to: number): IsoBox | null {
  if (at + 8 > to) return null
  let size = u32be(buf, at)
  let head = 8
  if (size === 1) {
    if (at + 16 > to) return null
    size = u32be(buf, at + 8) * 2 ** 32 + u32be(buf, at + 12)
    head = 16
  } else if (size === 0) {
    size = to - at
  }
  if (size < head || at + size > to) return null
  return { type: latin1(buf, at + 4, at + 8), start: at, body: at + head, end: at + size }
}

function isoChildren(buf: Uint8Array, from: number, to: number): IsoBox[] | null {
  const out: IsoBox[] = []
  for (let at = from; at < to; ) {
    const b = isoBox(buf, at, to)
    if (!b) return null
    out.push(b)
    at = b.end
  }
  return out
}

class IsoRefusal extends Error {}

function blank(out: Uint8Array, b: IsoBox, dropped: Set<string>) {
  dropped.add(`avif:${fourcc(b.type)}`)
  out.set(ascii('free'), b.start + 4)
  out.fill(0, b.body, b.end)
}

const readN = (b: Uint8Array, at: number, n: number) =>
  n === 0 ? 0 : n === 4 ? u32be(b, at) : n === 8 ? u32be(b, at) * 2 ** 32 + u32be(b, at + 4) : n === 2 ? u16be(b, at) : NaN

// Every box from `from` to `to`, judged in place in `out`.
function walkIso(out: Uint8Array, from: number, to: number, dropped: Set<string>, inSampleDescription = false) {
  const boxes = isoChildren(out, from, to)
  if (!boxes) throw new IsoRefusal('a part of the AVIF runs past its container')
  for (const b of boxes) {
    if (inSampleDescription && !ISO_CONTAINERS.has(b.type)) {
      // A track of a kind not on the list: blanking it would post a different picture.
      throw new IsoRefusal(`the AVIF holds a track ("${fourcc(b.type)}") Technetium cannot vouch for`)
    }
    if (b.type === 'meta') {
      // Only the top-level meta holds the picture's items; one nested in a
      // track or movie holds nothing a picture needs.
      blank(out, b, dropped)
    } else if (ISO_CONTAINERS.has(b.type)) {
      const skip = ISO_CONTAINERS.get(b.type)!
      if (b.body + skip > b.end) throw new IsoRefusal(`a "${fourcc(b.type)}" part of the AVIF is too short`)
      walkIso(out, b.body + skip, b.end, dropped, b.type === 'stsd')
    } else if (ISO_TIMED.has(b.type)) {
      const n = out[b.body] === 1 ? 8 : 4
      if (b.body + 4 + 2 * n > b.end) throw new IsoRefusal(`a "${fourcc(b.type)}" part of the AVIF is too short`)
      const times = out.subarray(b.body + 4, b.body + 4 + 2 * n)
      if (times.some((x) => x !== 0)) dropped.add(`avif:${b.type} times`)
      times.fill(0)
    } else if (b.type === 'dref') {
      const refs = isoChildren(out, b.body + 8, b.end)
      const local = refs?.every((r) => r.type === 'url ' && r.end - r.body === 4 && (out[r.body + 3] & 1) === 1)
      if (!local) throw new IsoRefusal('the AVIF points at data outside itself')
    } else if (!ISO_LEAVES.has(b.type)) {
      blank(out, b, dropped)
    }
  }
}

interface IlocItem {
  id: number
  raw: Uint8Array
  method: number
  extents: { offset: number; length: number }[]
}

function box(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length)
  put32be(out, 0, out.length)
  out.set(ascii(type), 4)
  out.set(body, 8)
  return out
}

function parseIloc(b: Uint8Array, body: number, end: number): { head: Uint8Array; v: number; items: IlocItem[] } {
  const v = b[body]
  let p = body + 4
  const offsetSize = b[p] >> 4
  const lengthSize = b[p] & 15
  const baseSize = b[p + 1] >> 4
  const indexSize = v === 1 || v === 2 ? b[p + 1] & 15 : 0
  p += 2
  const head = b.slice(body, p)
  const count = v < 2 ? u16be(b, p) : u32be(b, p)
  p += v < 2 ? 2 : 4
  const items: IlocItem[] = []
  for (let k = 0; k < count; k++) {
    const start = p
    const id = v < 2 ? u16be(b, p) : u32be(b, p)
    p += v < 2 ? 2 : 4
    let method = 0
    if (v === 1 || v === 2) {
      method = u16be(b, p) & 15
      p += 2
    }
    p += 2 // data_reference_index
    const base = readN(b, p, baseSize)
    p += baseSize
    const n = u16be(b, p)
    p += 2
    const extents: IlocItem['extents'] = []
    for (let e = 0; e < n; e++) {
      p += indexSize
      const offset = readN(b, p, offsetSize)
      p += offsetSize
      const length = readN(b, p, lengthSize)
      p += lengthSize
      extents.push({ offset: base + offset, length })
    }
    if (p > end || Number.isNaN(base)) throw new IsoRefusal("the AVIF's item locations do not read")
    items.push({ id, raw: b.slice(start, p), method, extents })
  }
  return { head, v, items }
}

// An ipma box without the associations of removed items.
function keptIpma(out: Uint8Array, k: IsoBox, removed: Set<number>): Uint8Array {
  const v = out[k.body]
  const wide = out[k.body + 3] & 1
  let p = k.body + 8
  const kept: Uint8Array[] = []
  for (let e = 0, count = u32be(out, k.body + 4); e < count; e++) {
    const start = p
    const id = v < 1 ? u16be(out, p) : u32be(out, p)
    p += v < 1 ? 2 : 4
    p += 1 + out[p] * (wide ? 2 : 1)
    if (p > k.end) throw new IsoRefusal("the AVIF's property table does not read")
    if (!removed.has(id)) kept.push(out.slice(start, p))
  }
  const n = new Uint8Array(4)
  put32be(n, 0, kept.length)
  return box('ipma', concat([out.subarray(k.body, k.body + 4), n, ...kept]))
}

function stripMeta(out: Uint8Array, meta: IsoBox, dropped: Set<string>) {
  const kids = isoChildren(out, meta.body + 4, meta.end)
  if (!kids) throw new IsoRefusal("the AVIF's item tables do not walk")
  const find = (t: string) => kids.find((k) => k.type === t)

  // Which items go: every one whose type is not a picture's.
  const removed = new Set<number>()
  const iinf = find('iinf')
  const keptInfe: Uint8Array[] = []
  let iinfVersion = 0
  if (iinf) {
    iinfVersion = out[iinf.body]
    const entries = isoChildren(out, iinf.body + (iinfVersion === 0 ? 6 : 8), iinf.end)
    if (!entries) throw new IsoRefusal("the AVIF's item list does not walk")
    for (const e of entries) {
      const v = out[e.body]
      if (e.type !== 'infe' || v < 2) throw new IsoRefusal('the AVIF names an item in a way Technetium cannot read')
      const id = v === 2 ? u16be(out, e.body + 4) : u32be(out, e.body + 4)
      const typeAt = e.body + 4 + (v === 2 ? 2 : 4) + 2
      const type = latin1(out, typeAt, typeAt + 4)
      if (!ISO_ITEM_TYPES.has(type)) {
        removed.add(id)
        dropped.add(type === 'mime' ? 'avif:XMP or other attached data' : `avif:${fourcc(type)} item`)
        continue
      }
      let nul = out.indexOf(0, typeAt + 4)
      if (nul < 0 || nul > e.end) nul = e.end
      if (!ISO_ITEM_NAMES.has(latin1(out, typeAt + 4, nul))) {
        out.fill(0, typeAt + 4, nul)
        dropped.add('avif:item name')
      }
      keptInfe.push(out.slice(e.start, e.end))
    }
  }
  const pitm = find('pitm')
  if (pitm) {
    const primary = out[pitm.body] === 0 ? u16be(out, pitm.body + 4) : u32be(out, pitm.body + 4)
    if (removed.has(primary)) throw new IsoRefusal('the AVIF has no picture as its main item')
  }

  // Everything else inside meta is judged like any other box first.
  for (const k of kids) {
    if (k.type === 'iinf' || k.type === 'iloc' || k.type === 'iref') continue
    if (k.type === 'iprp' || k.type === 'dinf') walkIso(out, k.body, k.end, dropped)
    else if (!ISO_LEAVES.has(k.type)) blank(out, k, dropped)
  }
  if (!removed.size) return

  const iloc = find('iloc')
  const located = iloc ? parseIloc(out, iloc.body, iloc.end) : null
  const idat = find('idat')
  for (const item of located?.items ?? []) {
    for (const x of item.extents) {
      const inMeta = item.method === 0 && x.offset < meta.end && x.offset + x.length > meta.start
      if (!removed.has(item.id)) {
        // Kept data inside meta would move when meta is rewritten.
        if (inMeta) throw new IsoRefusal('the AVIF keeps picture data where Technetium cannot clear around it')
        continue
      }
      if (item.method === 0 && !inMeta) out.fill(0, x.offset, x.length ? x.offset + x.length : out.length)
      else if (item.method === 1 && idat) out.fill(0, idat.body + x.offset, Math.min(idat.end, idat.body + x.offset + (x.length || idat.end)))
      else if (inMeta) throw new IsoRefusal('the AVIF keeps attached data where Technetium cannot clear it')
    }
  }

  const rebuilt: Uint8Array[] = []
  for (const k of kids) {
    if (k.type === 'iinf') {
      const n = new Uint8Array(iinfVersion === 0 ? 2 : 4)
      if (iinfVersion === 0) n.set([keptInfe.length >> 8, keptInfe.length & 0xff])
      else put32be(n, 0, keptInfe.length)
      rebuilt.push(box('iinf', concat([out.subarray(k.body, k.body + 4), n, ...keptInfe])))
    } else if (k.type === 'iloc' && located) {
      const kept = located.items.filter((x) => !removed.has(x.id))
      const n = new Uint8Array(located.v < 2 ? 2 : 4)
      if (located.v < 2) n.set([kept.length >> 8, kept.length & 0xff])
      else put32be(n, 0, kept.length)
      rebuilt.push(box('iloc', concat([located.head, n, ...kept.map((x) => x.raw)])))
    } else if (k.type === 'iprp') {
      // The property associations (ipma) sit inside iprp beside the
      // properties themselves (ipco), which stay where they are.
      const inner = isoChildren(out, k.body, k.end)
      if (!inner) throw new IsoRefusal("the AVIF's properties do not walk")
      rebuilt.push(box('iprp', concat(inner.map((c) => (c.type === 'ipma' ? keptIpma(out, c, removed) : out.slice(c.start, c.end))))))
    } else if (k.type === 'iref') {
      const v = out[k.body]
      const w = v === 0 ? 2 : 4
      const read = (at: number) => (w === 2 ? u16be(out, at) : u32be(out, at))
      const refs = isoChildren(out, k.body + 4, k.end)
      if (!refs) throw new IsoRefusal("the AVIF's item references do not walk")
      const kept: Uint8Array[] = []
      for (const r of refs) {
        const from = read(r.body)
        if (removed.has(from)) continue
        const n = u16be(out, r.body + w)
        const to: number[] = []
        for (let j = 0; j < n; j++) {
          const id = read(r.body + w + 2 + j * w)
          if (!removed.has(id)) to.push(id)
        }
        if (!to.length) continue
        const body = new Uint8Array(w + 2 + to.length * w)
        const dv = new DataView(body.buffer)
        if (w === 2) dv.setUint16(0, from)
        else dv.setUint32(0, from)
        dv.setUint16(w, to.length)
        to.forEach((id, j) => (w === 2 ? dv.setUint16(w + 2 + j * w, id) : dv.setUint32(w + 2 + j * w, id)))
        kept.push(box(r.type, body))
      }
      rebuilt.push(box('iref', concat([out.subarray(k.body, k.body + 4), ...kept])))
    } else {
      rebuilt.push(out.slice(k.start, k.end))
    }
  }
  const body = concat(rebuilt)
  const room = meta.end - (meta.body + 4)
  const pad = room - body.length
  if (pad < 0 || (pad > 0 && pad < 8)) throw new IsoRefusal("the AVIF's item tables could not be rewritten in place")
  out.set(body, meta.body + 4)
  if (pad) {
    put32be(out, meta.body + 4 + body.length, pad)
    out.set(ascii('free'), meta.body + 4 + body.length + 4)
    out.fill(0, meta.body + 4 + body.length + 8, meta.end)
  }
}

function brands(buf: Uint8Array, ftyp: IsoBox): Set<string> {
  const out = new Set<string>([latin1(buf, ftyp.body, ftyp.body + 4)])
  for (let at = ftyp.body + 8; at + 4 <= ftyp.end; at += 4) out.add(latin1(buf, at, at + 4))
  return out
}

function stripIso(buf: Uint8Array): StripResult {
  const top = isoChildren(buf, 0, buf.length)
  const ftyp = top?.[0]
  if (!top || !ftyp || ftyp.type !== 'ftyp') return refused(buf, "the file's parts do not walk", CONVERT)
  const b = brands(buf, ftyp)
  if (![...b].some((x) => AVIF_BRANDS.has(x))) {
    if ([...b].some((x) => HEIC_BRANDS.has(x)) || b.has('mif1') || b.has('msf1')) {
      return refused(buf, 'it is a HEIC photo, which most browsers cannot show',
        'convert it to JPEG first (on an iPhone, Settings > Camera > Formats > Most Compatible takes JPEGs from then on) and post that')
    }
    return refused(buf, 'it is not a picture format Technetium can clear of identifying details', CONVERT)
  }
  const out = buf.slice()
  const dropped = new Set<string>()
  try {
    for (const box of top) {
      if (box.type === 'meta') stripMeta(out, box, dropped)
      else if (box.type !== 'ftyp') walkIso(out, box.start, box.end, dropped)
    }
  } catch (err) {
    if (err instanceof IsoRefusal) return refused(buf, err.message)
    throw err
  }
  return result(buf, out, dropped)
}

// --- the door ------------------------------------------------------------------

/**
 * Keep only what the picture needs, plus its generation data.
 *
 * `bytes` is the input array itself when nothing changed. With `refusal`, the
 * file could not be cleared and must not be posted; `why` and `fix` are for
 * the poster.
 */
export async function stripIdentity(buf: Uint8Array): Promise<StripResult> {
  if (buf.length >= 8 && PNG_SIG.every((v, k) => buf[k] === v)) return stripPng(buf)
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) return stripJpeg(buf)
  if (buf.length >= 12 && startsWith(buf, 0, 'RIFF') && startsWith(buf, 8, 'WEBP')) return stripWebp(buf)
  if (buf.length >= 13 && (startsWith(buf, 0, 'GIF87a') || startsWith(buf, 0, 'GIF89a'))) return stripGif(buf)
  if (buf.length >= 12 && startsWith(buf, 4, 'ftyp')) return stripIso(buf)
  if (buf.length >= 26 && startsWith(buf, 0, 'BM')) return stripBmp(buf)
  if (buf.length >= 4 && (startsWith(buf, 0, 'II*\0') || startsWith(buf, 0, 'MM\0*'))) {
    return refused(buf, 'it is a TIFF, whose layout is itself made of identifying details', CONVERT)
  }
  return refused(buf, 'it is not a picture format Technetium can clear of identifying details', CONVERT)
}

// A file that could not be cleared, as an error any upload path can carry.
// Its message is the poster's whole sentence -- what, why, and what to do --
// so a surface that shows `err.message` tells them everything.
export class IdentityRefusal extends Error {
  why: string
  fix: string
  fileName: string

  constructor(fileName: string, reason: IdentityRefusalReason) {
    const name = fileName ? `"${fileName}"` : 'This picture'
    super(`${name} can't be posted: ${reason.why}. To post it, ${reason.fix}.`)
    this.name = 'IdentityRefusal'
    this.why = reason.why
    this.fix = reason.fix
    this.fileName = fileName
  }
}

/**
 * The File to upload in place of `file`: the same name and type, with what
 * identifies the poster gone. The very same File when nothing needed to go.
 * Throws IdentityRefusal when it cannot be cleared.
 */
export async function stripFile(file: File): Promise<{ file: File; dropped: string[] }> {
  const input = new Uint8Array(await file.arrayBuffer())
  const r = await stripIdentity(input)
  if (r.refusal) throw new IdentityRefusal(file.name, r.refusal)
  if (!r.changed) return { file, dropped: [] }
  // lastModified is the local clock's and never leaves the browser, but a
  // stripped copy has no reason to carry it either.
  return { file: new File([r.bytes as BlobPart], file.name, { type: file.type, lastModified: 0 }), dropped: r.dropped }
}
