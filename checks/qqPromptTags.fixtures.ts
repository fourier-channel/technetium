// Synthetic images for checks/qqPromptTags.check.ts. Every name and prompt
// here is invented: no real person, handle or character. Each fixture is the
// bytes of a file the way one generator or saver writes it, small enough to
// read in a diff.
//
// The expected results in the check were produced by running fourier-tunnel's
// prompt-tags.js, the parser this one ports, over these same bytes. A change
// to a fixture means re-running the original, not editing the expectation to
// match the port.

const enc = new TextEncoder()
const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff)

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

const be32 = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255)
const le32 = (n: number) => Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24)
const be16 = (n: number) => Uint8Array.of(n >>> 8, n & 255)
const le16 = (n: number) => Uint8Array.of(n & 255, n >>> 8)

async function deflate(b: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([b as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(s).arrayBuffer())
}

// --- PNG: a signature, the given chunks, IEND. CRCs are zero: neither parser
// checks them.
const PNG_SIG = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)
const chunk = (type: string, data: Uint8Array) => concat(be32(data.length), latin1(type), data, new Uint8Array(4))
const png = (...chunks: Uint8Array[]) =>
  concat(PNG_SIG, chunk('IHDR', new Uint8Array(13)), ...chunks, chunk('IDAT', new Uint8Array(10)), chunk('IEND', new Uint8Array(0)))
const tEXt = (k: string, v: string) => chunk('tEXt', concat(latin1(k), Uint8Array.of(0), latin1(v)))
const zTXt = async (k: string, v: string) => chunk('zTXt', concat(latin1(k), Uint8Array.of(0, 0), await deflate(enc.encode(v))))
const iTXt = async (k: string, v: string, compressed: boolean) => chunk('iTXt', concat(
  latin1(k), Uint8Array.of(0, compressed ? 1 : 0, 0), latin1('en'), Uint8Array.of(0), Uint8Array.of(0),
  compressed ? await deflate(enc.encode(v)) : enc.encode(v)))

// --- TIFF holding UserComment (in an ExifIFD) and/or ImageDescription (IFD0).
function tiff(order: 'II' | 'MM', fields: { userComment?: Uint8Array; description?: Uint8Array }): Uint8Array {
  const u16 = order === 'II' ? le16 : be16
  const u32 = order === 'II' ? le32 : be32
  const ifd0: [number, number, Uint8Array][] = []   // tag, type, value (offset patched below)
  if (fields.description) ifd0.push([0x010e, 2, fields.description])
  // Layout: header(8) | IFD0 | ExifIFD | data
  const ifd0Len = 2 + 12 * (ifd0.length + (fields.userComment ? 1 : 0)) + 4
  const exifAt = 8 + ifd0Len
  const exifLen = fields.userComment ? 2 + 12 + 4 : 0
  let dataAt = exifAt + exifLen
  const data: Uint8Array[] = []
  const entry = (tag: number, type: number, value: Uint8Array) => {
    if (value.length <= 4) {
      const v = new Uint8Array(4); v.set(value)
      return concat(u16(tag), u16(type), u32(value.length), v)
    }
    const at = dataAt
    data.push(value); dataAt += value.length
    return concat(u16(tag), u16(type), u32(value.length), u32(at))
  }
  const ifd0Entries = ifd0.map(([t, ty, v]) => entry(t, ty, v))
  if (fields.userComment) ifd0Entries.push(concat(u16(0x8769), u16(4), u32(1), u32(exifAt)))
  const exifEntries = fields.userComment ? [entry(0x9286, 7, fields.userComment)] : []
  return concat(
    latin1(order), u16(42), u32(8),
    u16(ifd0Entries.length), ...ifd0Entries, u32(0),
    ...(exifEntries.length ? [u16(1), ...exifEntries, u32(0)] : []),
    ...data)
}

const EXIF = latin1('Exif\0\0')
const jpeg = (t: Uint8Array) => concat(
  Uint8Array.of(0xff, 0xd8),
  Uint8Array.of(0xff, 0xe0), be16(16), latin1('JFIF\0'), new Uint8Array(9),   // APP0 first, as most JPEGs
  Uint8Array.of(0xff, 0xe1), be16(2 + 6 + t.length), EXIF, t,
  Uint8Array.of(0xff, 0xda), be16(8), new Uint8Array(6), Uint8Array.of(1, 2, 3, 0xff, 0xd9))
function webp(t: Uint8Array, withHeader: boolean): Uint8Array {
  const body = withHeader ? concat(EXIF, t) : t
  const pad = body.length & 1 ? Uint8Array.of(0) : new Uint8Array(0)
  const vp8 = concat(latin1('VP8 '), le32(4), new Uint8Array(4))
  const exif = concat(latin1('EXIF'), le32(body.length), body, pad)
  return concat(latin1('RIFF'), le32(4 + vp8.length + exif.length), latin1('WEBP'), vp8, exif)
}

const comment = (prefix: string, body: Uint8Array) => concat(latin1(prefix), body)
function utf16(s: string, bigEndian: boolean): Uint8Array {
  const out = new Uint8Array(s.length * 2)
  for (let k = 0; k < s.length; k++) {
    const c = s.charCodeAt(k)
    out[2 * k + (bigEndian ? 1 : 0)] = c & 255
    out[2 * k + (bigEndian ? 0 : 1)] = c >>> 8
  }
  return out
}

// --- The prompts -------------------------------------------------------------

export const A1111 =
  'masterpiece, best quality, (solo:1.2), 1girl, ((silver hair)), lumen \\(starfall\\), blue eyes, <lora:glowy:0.8>, ' +
  'smile BREAK outdoors, night sky\nNegative prompt: lowres, bad hands\nSteps: 28, Sampler: Euler a, CFG scale: 6'
const COMFY_GRAPH = JSON.stringify({
  3: { class_type: 'KSampler', inputs: { seed: 1 } },
  6: { class_type: 'CLIPTextEncode', inputs: { text: 'harbor town, sunset, (kiri_oc:0) white hair, ferry, gulls, warm light' } },
  7: { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, watermark' } },
})
const NOVELAI = JSON.stringify({ prompt: 'forest shrine, maple \\(tester\\), fox ears, autumn leaves, best quality', steps: 28 })

export interface Fixture { name: string; bytes: () => Promise<Uint8Array> }

export const FIXTURES: Fixture[] = [
  { name: 'png tEXt parameters (A1111)', bytes: async () => png(tEXt('parameters', A1111)) },
  { name: 'png tEXt prompt (ComfyUI graph)', bytes: async () => png(tEXt('prompt', COMFY_GRAPH), tEXt('workflow', '{"nodes":[]}')) },
  { name: 'png zTXt parameters', bytes: async () => png(await zTXt('parameters', A1111)) },
  { name: 'png zTXt parameters, non-ASCII', bytes: async () => png(await zTXt('parameters', 'snow \u00e9t\u00e9, \u732b, lantern\nSteps: 9')) },
  { name: 'png iTXt Comment compressed (NovelAI)', bytes: async () => png(tEXt('Description', 'a fox at a shrine'), await iTXt('Comment', NOVELAI, true)) },
  { name: 'png iTXt parameters plain, non-ASCII', bytes: async () => png(await iTXt('parameters', 'caf\u00e9 terrace, \u7d05\u8449, rain\nSteps: 20', false)) },
  { name: 'png tEXt Description only', bytes: async () => png(tEXt('Description', 'quiet library, lamplight, cat on desk')) },
  { name: 'png zTXt corrupt, then tEXt', bytes: async () => png(chunk('zTXt', concat(latin1('parameters'), Uint8Array.of(0, 0, 1, 2, 3))), tEXt('Description', 'kept after a bad chunk')) },
  { name: 'png with no text', bytes: async () => png() },
  { name: 'jpeg UserComment ASCII, MM', bytes: async () => jpeg(tiff('MM', { userComment: comment('ASCII\0\0\0', enc.encode(A1111)) })) },
  { name: 'jpeg UserComment UNICODE big-endian', bytes: async () => jpeg(tiff('II', { userComment: comment('UNICODE\0', utf16(A1111, true)) })) },
  { name: 'jpeg UserComment UNICODE little-endian', bytes: async () => jpeg(tiff('MM', { userComment: comment('UNICODE\0', utf16(A1111, false)) })) },
  { name: 'jpeg UserComment with no charset prefix', bytes: async () => jpeg(tiff('II', { userComment: enc.encode('{"prompt": "lighthouse, storm, waves", "seed": 3}') })) },
  { name: 'jpeg UserComment zero prefix, NUL padded', bytes: async () => jpeg(tiff('II', { userComment: comment('\0\0\0\0\0\0\0\0', enc.encode('tea house, rain, lanterns\0\0')) })) },
  { name: 'jpeg ImageDescription ComfyUI graph', bytes: async () => jpeg(tiff('II', { description: enc.encode(COMFY_GRAPH) })) },
  { name: 'jpeg graph nested under .prompt', bytes: async () => jpeg(tiff('MM', { userComment: comment('ASCII\0\0\0', enc.encode(JSON.stringify({ prompt: JSON.parse(COMFY_GRAPH) }))) })) },
  { name: 'webp EXIF with Exif header, labelled ComfyUI', bytes: async () => webp(tiff('II', { description: enc.encode('workflow:{"nodes":[]}'), userComment: comment('ASCII\0\0\0', enc.encode('prompt:' + COMFY_GRAPH)) }), true) },
  { name: 'webp EXIF labelled, no prompt label', bytes: async () => webp(tiff('II', { description: enc.encode('workflow:{"3":{"class_type":"CLIPTextEncode","inputs":{"text":"not a prompt"}}}') }), true) },
  { name: 'webp EXIF with no Exif header, NovelAI', bytes: async () => webp(tiff('MM', { userComment: comment('UNICODE\0', utf16(NOVELAI, true)) }), false) },
  { name: 'webp with no EXIF', bytes: async () => concat(latin1('RIFF'), le32(16), latin1('WEBP'), latin1('VP8 '), le32(4), new Uint8Array(4)) },
  { name: 'not an image', bytes: async () => enc.encode('GIF89a this is not read at all') },
  { name: 'truncated png', bytes: async () => (png(tEXt('parameters', A1111))).subarray(0, 40) },
]

/** Terms for normalizeTerm and expandTerm, invented, one per shape. */
export const TERMS: string[] = [
  'lumen \\(starfall\\)', 'lumen (starfall)', '(lumen:1.3)', '((silver hair))', '[blue eyes]', '{red scarf}',
  'name (1.2)', 're:zero style', '(kiri_oc:0) white hair', '(maple_\\(tester\\):1.1) fox ears', '@somebody',
  '-negative lead', '~tilde lead', '  spaced   out  ', 'Mixed CASE Words', 'caf\u00e9', 'a (b) c (d)', '(a) (b)',
  'oc_kiri', 'kiri_character_oc', 'x', '2024', '1.5', 'year_2024', 'ultra-detailed',
]

/** Prompts for promptToTags with options, invented. */
export const PROMPTS: { prompt: string; opts?: { max?: number; owner?: string | null } }[] = [
  { prompt: A1111.split('\n')[0] },
  { prompt: 'maple \\(tester\\), lumen \\(starfall\\), oc_kiri, hat', opts: { owner: 'tester' } },
  { prompt: 'maple \\(tester\\), lumen \\(starfall\\), oc_kiri, hat', opts: { owner: null } },
  { prompt: 'a1, b2, c3, d4, masterpiece, e5, lumen \\(starfall\\)', opts: { max: 3 } },
  { prompt: 'dup, Dup, DUP, (dup:1.1), dup' },
  { prompt: '' },
]
