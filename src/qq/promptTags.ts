// ---------------------------------------------------------------------------
// The prompt in an AI-generated picture, read on the device and split into
// tags: QuickQueue's Scan (master reference sec 22.8, tc.152 step 2).
//
// A PORT, NOT A NEW PARSER. This is fourier-tunnel's prompt-tags.js, the
// parser Tonneru-chan files creator tags with, moved from Node Buffers to
// Uint8Array so it runs in a browser. The decisions are the original's, line
// for line, so the tags a user filters their own library by are the tags the
// booru would read from the same file. Where a comment below explains WHY a
// rule exists, the reason is the original's. A change to the rules is made
// there first and ported here; the port carries no rule of its own.
//
// What differs, and only in mechanics:
//   - zTXt and compressed iTXt inflate through DecompressionStream, which is
//     asynchronous, so embeddedChunks returns a Promise.
//   - Text decodes match Node's: latin1 maps each byte to one code point (a
//     TextDecoder('latin1') is windows-1252 and would not), UTF-8 keeps a
//     leading BOM as Node does, UTF-16LE drops an odd trailing byte as Node
//     does.
//
// What is NOT ported: chunksFromFields, which reads the fields
// strip-generation.js took out of a file at ingest (Easy Diffusion's bare
// "prompt" chunk, ComfyUI's WebP prompt in EXIF Model, Mochi Diffusion's
// caption line, the stealth copy in a PNG's pixels). Scan reads the file's
// bytes, as embeddedChunks does; those four shapes give no tags here, as they
// give none to embeddedChunks in the original.
//
// Parity is measured, not assumed: canon keeps a tool that runs both parsers
// over a real library and prints only how many files disagree.
//
// NOTHING HERE LEAVES THE DEVICE. 41chan avoids reading prompts (master
// reference sec 22.8, operator 2026-11-20); this module only turns a file's
// own text into tags for the index kept beside that file.
// ---------------------------------------------------------------------------

import { inflate } from '../client/identityStrip'

export type Chunks = Record<string, string>

export interface PromptTags {
  /** Private content terms, at most `max`. */
  tags: string[]
  /** Quality and meta terms, kept but de-emphasised. */
  meta: string[]
  /** Original characters (see ORIGINAL CHARACTERS below). */
  characters: string[]
}

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10]
const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0, 0] // "Exif\0\0"

// --- Bytes, decoded as Node decodes them ------------------------------------

function latin1(b: Uint8Array, from: number, to: number): string {
  const end = Math.min(to, b.length)
  let s = ''
  for (let k = from; k < end; k += 8192) s += String.fromCharCode(...b.subarray(k, Math.min(end, k + 8192)))
  return s
}

const utf8Decoder = new TextDecoder('utf-8', { ignoreBOM: true })
const utf8 = (b: Uint8Array) => utf8Decoder.decode(b)

// Node's 'utf16le': code units as written, an odd last byte dropped, lone
// surrogates kept (a TextDecoder would replace them).
function utf16le(b: Uint8Array): string {
  const n = b.length - (b.length % 2)
  let s = ''
  const units: number[] = []
  for (let k = 0; k < n; k += 2) {
    units.push(b[k] | (b[k + 1] << 8))
    if (units.length === 8192) { s += String.fromCharCode(...units); units.length = 0 }
  }
  return s + String.fromCharCode(...units)
}

function bytesAt(b: Uint8Array, at: number, want: readonly number[]): boolean {
  if (at + want.length > b.length) return false
  for (let k = 0; k < want.length; k++) if (b[at + k] !== want[k]) return false
  return true
}

const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3]
const u16be = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1]
const u32le = (b: Uint8Array, at: number) => b[at] + (b[at + 1] << 8) + (b[at + 2] << 16) + ((b[at + 3] << 24) >>> 0)

// --- PNG --------------------------------------------------------------------

// Read tEXt / zTXt / iTXt textual chunks from a PNG buffer -> { keyword: text }.
// CRCs are not validated (we only read metadata, never re-emit the file).
export async function pngTextChunks(buf: Uint8Array): Promise<Chunks> {
  const out: Chunks = {}
  if (buf.length < 8 || !bytesAt(buf, 0, PNG_SIG)) return out
  let off = 8
  while (off + 8 <= buf.length) {
    const len = u32be(buf, off)
    const type = latin1(buf, off + 4, off + 8)
    const start = off + 8
    const end = start + len
    if (end > buf.length) break
    const data = buf.subarray(start, end)
    if (type === 'tEXt') {
      const z = data.indexOf(0)
      if (z > 0) out[latin1(data, 0, z)] = latin1(data, z + 1, data.length)
    } else if (type === 'zTXt') {
      const z = data.indexOf(0)
      if (z > 0) {
        const body = await inflate(data.subarray(z + 2))
        if (body) out[latin1(data, 0, z)] = utf8(body)   // a malformed chunk is skipped
      }
    } else if (type === 'iTXt') {
      const z = data.indexOf(0)
      if (z > 0) {
        const keyword = latin1(data, 0, z)
        const compressed = data[z + 1] === 1
        // keyword \0 compFlag compMethod langTag \0 translatedKeyword \0 text
        let p = z + 3
        p = data.indexOf(0, p) + 1
        p = data.indexOf(0, p) + 1
        const text = data.subarray(p)
        if (!compressed) out[keyword] = utf8(text)
        else {
          const body = await inflate(text)
          if (body) out[keyword] = utf8(body)
        }
      }
    }
    if (type === 'IEND') break
    off = end + 4 // + CRC
  }
  return out
}

// --- EXIF (JPEG, WebP) -------------------------------------------------------

const TAG_EXIFIFD = 0x8769
const TAG_USERCOMMENT = 0x9286
const TAG_IMAGEDESCRIPTION = 0x010e

// The TIFF payload of a JPEG's APP1/Exif segment, or undefined. Walks the
// marker chain from SOI; stops at SOS/EOI, because past the scan there are no
// more segments and a scan can be megabytes.
export function jpegTiff(buf: Uint8Array): Uint8Array | undefined {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return undefined
  let i = 2
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue }
    const marker = buf[i + 1]
    if (marker === 0xff) { i += 1; continue }                                      // fill byte
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue } // no length
    if (marker === 0xd9 || marker === 0xda) return undefined
    const len = u16be(buf, i + 2)
    if (len < 2) return undefined
    if (marker === 0xe1 && bytesAt(buf, i + 4, EXIF_HEADER)) return buf.subarray(i + 10, i + 2 + len)
    i += 2 + len
  }
  return undefined
}

// The TIFF payload of a WebP's EXIF chunk, or undefined. RIFF: "RIFF" size
// "WEBP" then fourcc/size chunks, each padded to even length. The EXIF chunk
// may or may not start with "Exif\0\0"; both are seen in the wild.
export function webpTiff(buf: Uint8Array): Uint8Array | undefined {
  if (buf.length < 12 || latin1(buf, 0, 4) !== 'RIFF' || latin1(buf, 8, 12) !== 'WEBP') return undefined
  let i = 12
  while (i + 8 <= buf.length) {
    const fourcc = latin1(buf, i, i + 4)
    const size = u32le(buf, i + 4)
    const start = i + 8
    const end = start + size
    if (end > buf.length) return undefined
    if (fourcc === 'EXIF') {
      const data = buf.subarray(start, end)
      return bytesAt(data, 0, EXIF_HEADER) ? data.subarray(6) : data
    }
    i = end + (size & 1)
  }
  return undefined
}

// UserComment is 8 bytes of charset then the body. Generators that write it
// natively use UNICODE with a UTF-16 body (piexif writes big-endian; other
// tools little-endian), fourier-sampling writes ASCII, and a zeroed prefix
// means "undefined". The UTF-16 byte order is decided by looking at the text:
// the wrong order turns every character into a CJK code point, so the decode
// with more plain ASCII in it is the right one.
//
// NO KNOWN PREFIX, NO PREFIX. Pillow sets exif[0x9286] to a plain string and
// writes it with no charset at all -- Fooocus saves its whole generation
// record that way -- so the first 8 bytes are TEXT. Only the four headers the
// EXIF spec names are taken as one.
export function decodeUserComment(raw: Uint8Array): string {
  if (raw.length < 8) return utf8(raw).replace(/\0+$/, '')
  const prefix = latin1(raw, 0, 8)
  const body = raw.subarray(8)
  if (prefix === 'UNICODE\0') {
    const le = utf16le(body)
    const swapped = body.slice()
    if (swapped.length % 2 === 0) for (let k = 0; k < swapped.length; k += 2) { const x = swapped[k]; swapped[k] = swapped[k + 1]; swapped[k + 1] = x }
    const be = utf16le(swapped)
    const ascii = (t: string) => (t.match(/[\x20-\x7e]/g) || []).length
    return (ascii(be) >= ascii(le) ? be : le).replace(/\0+$/, '')
  }
  if (prefix === 'JIS\0\0\0\0\0') return latin1(body, 0, body.length)
  if (prefix === 'ASCII\0\0\0' || prefix === '\0\0\0\0\0\0\0\0') return utf8(body).replace(/\0+$/, '')
  return utf8(raw).replace(/\0+$/, '')
}

export interface ExifText { UserComment?: string; ImageDescription?: string }

// { UserComment?, ImageDescription? } read from a TIFF payload: IFD0 and the
// ExifIFD it points at, both byte orders, bounds-checked at every step.
export function exifTextFields(t: Uint8Array | undefined): ExifText {
  const out: ExifText = {}
  if (!t || t.length < 8) return out
  const order = latin1(t, 0, 2)
  if (order !== 'MM' && order !== 'II') return out
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength)
  const le = order === 'II'
  const u16 = (o: number) => dv.getUint16(o, le)
  const u32 = (o: number) => dv.getUint32(o, le)
  const value = (e: number, cnt: number) => {
    const off = cnt <= 4 ? e + 8 : u32(e + 8)
    if (off + cnt > t.length) return undefined
    return t.subarray(off, off + cnt)
  }
  const walk = (off: number, depth: number) => {
    if (depth > 2 || off + 2 > t.length) return
    const n = u16(off)
    for (let k = 0; k < n; k++) {
      const e = off + 2 + k * 12
      if (e + 12 > t.length) return
      const tag = u16(e)
      const cnt = u32(e + 4)
      if (tag === TAG_EXIFIFD) walk(u32(e + 8), depth + 1)
      else if (tag === TAG_USERCOMMENT && out.UserComment === undefined) {
        const raw = value(e, cnt)
        if (raw) out.UserComment = decodeUserComment(raw)
      } else if (tag === TAG_IMAGEDESCRIPTION && out.ImageDescription === undefined) {
        const raw = value(e, cnt)
        if (raw) out.ImageDescription = utf8(raw).replace(/\0+$/, '')
      }
    }
  }
  walk(u32(4), 0)
  return out
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'

// EXIF text has no keyword to say which embedding it is, so the SHAPE decides:
// a JSON graph of class_type nodes is ComfyUI's "prompt"; JSON carrying a
// .prompt is NovelAI's "Comment" (or a saver that nested the graph under
// .prompt, which rawPrompt reads the same way once unwrapped); anything else
// is A1111's "parameters".
export function exifChunks(fields: ExifText): Chunks {
  const chunks: Chunks = {}
  for (const text of [fields.UserComment, fields.ImageDescription]) {
    if (typeof text !== 'string' || !text.trim()) continue
    const trimmed = text.trim()
    // ComfyUI's WebP saver labels each entry it writes, "<key>:<json>": the
    // graph under "prompt", anything else (a custom node's note, a version)
    // is not a prompt and must not be read as one.
    const labelled = /^([\w.-]{1,64}):\s*([[{][\s\S]*)$/.exec(trimmed)
    if (labelled) {
      if (labelled[1] === 'prompt' && chunks.prompt === undefined) chunks.prompt = labelled[2]
      continue
    }
    if (trimmed.startsWith('{')) {
      try {
        const j: unknown = JSON.parse(trimmed)
        const isGraph = (g: unknown) => isObject(g) && Object.values(g).some((n) => isObject(n) && 'class_type' in n)
        if (isGraph(j)) { chunks.prompt = chunks.prompt || trimmed; continue }
        if (isObject(j) && isGraph(j.prompt)) { chunks.prompt = chunks.prompt || JSON.stringify(j.prompt); continue }
        if (isObject(j) && typeof j.prompt === 'string') { chunks.Comment = chunks.Comment || trimmed; continue }
      } catch { /* not JSON: fall through to parameters */ }
    }
    chunks.parameters = chunks.parameters || trimmed
  }
  return chunks
}

// Pull the positive-prompt string out of whatever embedding is present.
export function rawPrompt(chunks: Chunks): string {
  if (typeof chunks.parameters === 'string') {
    const t = chunks.parameters
    const neg = t.indexOf('\nNegative prompt:')
    const steps = t.indexOf('\nSteps:')
    const end = neg >= 0 ? neg : (steps >= 0 ? steps : t.length)
    return t.slice(0, end).trim()
  }
  if (typeof chunks.prompt === 'string') {
    try {
      const graph: unknown = JSON.parse(chunks.prompt)
      const texts: string[] = []
      if (isObject(graph)) {
        for (const k in graph) {
          const node = graph[k]
          if (isObject(node) && /CLIPTextEncode/i.test(String(node.class_type || '')) &&
              isObject(node.inputs) && typeof node.inputs.text === 'string') {
            texts.push(node.inputs.text)
          }
        }
      }
      // The longest CLIP text block is almost always the positive prompt.
      texts.sort((a, b) => b.length - a.length)
      if (texts.length) return texts[0].trim()
    } catch { /* not JSON we understand */ }
  }
  for (const key of ['Comment', 'Description']) {
    if (typeof chunks[key] === 'string') {
      try {
        const c: unknown = JSON.parse(chunks[key])
        if (isObject(c) && typeof c.prompt === 'string') return c.prompt.trim()
      } catch {
        if (key === 'Description') return chunks[key].trim()
      }
    }
  }
  return ''
}

// --- Prompt -> tags ----------------------------------------------------------

// Curated quality/booster + meta terms, kept but classified separately so a
// view can tuck them away rather than drop them. Realism vernacular
// (photorealistic, realistic...) is never added: a prompt word is noise, and
// only the taggers decide whether an image looks photorealistic (operator
// ruling 2026-11-01). Kept identical to the original's list.
export const QUALITY_META: ReadonlySet<string> = new Set([
  'masterpiece', 'best_quality', 'high_quality', 'normal_quality', 'low_quality', 'worst_quality',
  'amazing_quality', 'great_quality', 'best_aesthetic', 'high_aesthetic', 'aesthetic', 'very_aesthetic',
  'ultra-detailed', 'ultra_detailed', 'highly_detailed', 'very_detailed', 'extremely_detailed',
  'super_detailed', 'intricate_details', 'intricate', 'detailed',
  'highres', 'absurdres', 'incredibly_absurdres', 'lowres', 'hires', 'hi_res', '4k', '8k', '2k', 'uhd', '16k',
  'official_art', 'concept_art', 'key_visual', 'promotional_art', 'game_cg', 'cg',
  'award_winning', 'award-winning', 'trending_on_artstation', 'artstation', 'pixiv', 'featured_on_pixiv',
  'sharp_focus', 'professional', 'professional_lighting', 'studio_quality', 'source_quality',
  'jpeg_artifacts', 'scan_artifacts', 'artifacts', 'film_grain',
  'newest', 'recent', 'oldest', 'year_2023', 'year_2024', 'year_2025', 'year_2026',
])

// One prompt term -> one Danbooru-shaped name, or "" for nothing usable.
//
// THE QUALIFIER SURVIVES. Danbooru names a character with her series in
// parentheses, and a prompt written for a booru-trained model carries exactly
// that, escaped for the generator: "name \(series\)". Three shapes are told
// apart:
//   \( ... \)      escaped -- always literal, always kept
//   ( ... :1.2)    a weight -- the parentheses and the weight go, the term stays
//   (( ... ))      emphasis -- the parentheses go, the term stays
//   name (series)  unescaped but TRAILING a name, no weight -- a qualifier
//                  written ComfyUI-style, where nothing needs escaping; kept
// Colons survive too (re:zero has one): a colon followed by a number is the
// only thing read as a weight.
export function normalizeTerm(raw: unknown): string {
  // \u0001/\u0002 hold escaped parentheses aside, as the original does
  let t = String(raw).replace(/\\\(/g, '\u0001').replace(/\\\)/g, '\u0002')
  t = t.replace(/:\s*[\d.]+(?=\s*[)\]}]|\s*$)/g, '')                  // (tag:1.2) weights
  const q = /^([^()]*[^\s()])\s*\(([^()]+)\)\s*$/.exec(t)               // name (series)
  if (q && !/^[\d.\s]+$/.test(q[2])) t = `${q[1]} \u0001${q[2]}\u0002`
  t = t.replace(/[()[\]{}]/g, ' ').replace(/\\+/g, ' ')
  // eslint-disable-next-line no-control-regex -- the escaped parentheses come back
  t = t.replace(/\u0001/g, '(').replace(/\u0002/g, ')')
  return t
    .trim()
    .toLowerCase()
    .replace(/\s*\(\s*/g, '_(').replace(/\s*\)/g, ')')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/[^a-z0-9_'./:!?&+()-]/g, '')
    // Danbooru's own rule: a tag may not begin with -, ~ or * (search
    // operators), and a leading @ is a handle out of a prompt's credits.
    .replace(/^[-~*@_]+|_+$/g, '')
}

// ORIGINAL CHARACTERS. An original character's tag is <name>_(<creator>)
// (operator ruling 2026-10-11). The poster is not always the creator, so a
// term is one of three kinds:
//   1. <name>_(<owner>), `owner` being the poster's own localpart: in
//      `characters` only, never counted against `max`.
//   2. A legacy form -- oc_<name>, character_oc_<name>, <name>_oc,
//      <name>_character_oc -- for any poster: in `characters` only, as written.
//   3. Any other qualified name: a term like the rest of the prompt, counted
//      against `max`, and in `characters` too. A name past `max` is in
//      neither list.
export const ORIGINAL_CHARACTER = /^([a-z0-9][^()]*)_\(([^()]+)\)$/
export const LEGACY_ORIGINAL_CHARACTER = /^(?:(?:character_)?oc_[a-z0-9].*|.*[a-z0-9]_(?:character_)?oc)$/

function characterKind(term: string, owner: string | null): 'declared' | 'offered' | null {
  const m = ORIGINAL_CHARACTER.exec(term)
  if (!m) return LEGACY_ORIGINAL_CHARACTER.test(term) ? 'declared' : null
  return owner && m[2] === String(owner).toLowerCase() ? 'declared' : 'offered'
}

// A PARENTHESISED TOKEN RUNS INTO THE WORDS AFTER IT. "(name_oc:0) white
// hair" is one comma-separated term in a real prompt, so a term is first split
// into pieces: every UNESCAPED parenthesised group that carries a weight, or
// that leads the term with text after it, is its own piece, and the text
// around it is another. The one group left alone is a trailing, unweighted
// "(series)" after a name: a qualifier, which normalizeTerm keeps. Escaped
// \(...\) never splits, and a group may HOLD one.
const GROUP = /(?<!\\)\(((?:\\[()]|[^()])*?)(?<!\\)\)/g

export function expandTerm(raw: unknown): string[] {
  const t = String(raw)
  const groups = [...t.matchAll(GROUP)]
  if (!groups.length) return [t]
  const only = groups.length === 1 ? groups[0] : null
  if (only) {
    const before = t.slice(0, only.index)
    const after = t.slice(only.index + only[0].length)
    const weighted = /:\s*[\d.]+\s*$/.test(only[1])
    if (!weighted && before.trim() && !after.trim()) return [t] // name (series)
    if (!before.trim() && !after.trim()) return [t]               // (tag:1.2), ((tag))
  }
  const pieces: string[] = []
  let cursor = 0
  for (const g of groups) {
    const before = t.slice(cursor, g.index)
    if (before.trim()) pieces.push(before)
    pieces.push(g[0])
    cursor = g.index + g[0].length
  }
  const tail = t.slice(cursor)
  if (tail.trim()) pieces.push(tail)
  return pieces
}

export interface PromptTagOptions {
  /** Most content terms kept; default 60, as the original. */
  max?: number
  /** The poster's own localpart, or null. */
  owner?: string | null
}

// Normalise a freeform prompt into Danbooru-style tags: comma-split, strip
// weights/brackets/LoRA tokens, lowercase, spaces -> underscores, dedupe.
export function promptToTags(prompt: string, opts?: PromptTagOptions): PromptTags {
  const max = (opts && opts.max) || 60
  const owner = (opts && opts.owner) || null
  const out: PromptTags = { tags: [], meta: [], characters: [] }
  if (!prompt) return out
  const seen = new Set<string>()
  const cleaned = String(prompt).replace(/<[^>]*>/g, ' ').replace(/\bBREAK\b/g, ',')
  for (const term of cleaned.split(',')) for (const raw of expandTerm(term)) {
    const t = normalizeTerm(raw)
    if (t.length < 2 || t.length > 60) continue
    if (/^[\d_.]+$/.test(t)) continue
    if (seen.has(t)) continue
    seen.add(t)
    const kind = characterKind(t, owner)
    if (kind === 'declared') out.characters.push(t)
    else if (QUALITY_META.has(t)) out.meta.push(t)
    else if (out.tags.length < max) {
      out.tags.push(t)
      if (kind === 'offered') out.characters.push(t)
    }
  }
  return out
}

// The embedded text of an image, keyed the way a PNG keys it, whatever the
// container. THE BYTES DECIDE, not the name or the declared type.
export async function embeddedChunks(buffer: Uint8Array, contentType?: string): Promise<Chunks> {
  if (buffer.length < 12) return {}
  if (bytesAt(buffer, 0, PNG_SIG)) return pngTextChunks(buffer)
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return exifChunks(exifTextFields(jpegTiff(buffer)))
  if (latin1(buffer, 0, 4) === 'RIFF' && latin1(buffer, 8, 12) === 'WEBP') return exifChunks(exifTextFields(webpTiff(buffer)))
  // Unrecognised magic: trust the declared type once, for a PNG whose
  // signature was damaged but whose chunks may still read.
  if (contentType && /png/i.test(contentType)) return pngTextChunks(buffer)
  return {}
}

/** Image bytes -> the tags of its prompt. Never throws. */
export async function extractPromptTags(buffer: Uint8Array, opts?: PromptTagOptions): Promise<PromptTags> {
  try {
    return promptToTags(rawPrompt(await embeddedChunks(buffer)), opts)
  } catch { /* fail soft, as the original */ }
  return { tags: [], meta: [], characters: [] }
}
