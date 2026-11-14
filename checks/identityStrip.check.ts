// Nothing that identifies the poster leaves the device (QuickQueue M1, tc.151).
//
// Drives src/client/identityStrip.ts over real pictures (checks/identityFixtures.ts:
// Pillow-made 8x8 images given GPS, a camera make, model and serial, an
// artist, a capture time, XMP, IPTC and a trailer by exiftool, beside a
// generation prompt) and judges what comes out WITH WALKERS OF ITS OWN: a TIFF
// structure is found by scanning every byte for its header, not by asking the
// stripper where it put one.
//
// A pass means: no planted string is in any byte; every EXIF block holds only
// Orientation and the prompt fields; the prompt survives (except AVIF, whose
// Exif item goes whole -- a known loss, below); the picture's own bytes are
// still there; stripping again changes nothing; and `dropped` names kinds,
// never content.
//
// THE SABOTAGE CONTROL: the same judge run on the UNSTRIPPED fixtures, and on
// a stripped one with its prompt wiped, must FAIL. A judge that passes those
// is not judging.
//
// WHAT THIS CANNOT SEE: whether a browser draws the result. On 2026-11-14 each
// output was decoded by Pillow and compared pixel for pixel with its input
// (all equal), and each was passed through fourier-tunnel's own
// stripGeneration (take + strip + identity-check): all five accepted, the
// prompt taken from PNG, JPEG, WebP and GIF -- and the AVIF input, unstripped,
// was refused by the tunnel while the stripped AVIF passed. Neither tool is a
// dependency of this suite, so those runs are recorded here, not repeated.
import { IdentityRefusal, stripIdentity } from '../src/client/identityStrip.ts'
import { FIXTURES } from './identityFixtures.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const bytesOf = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'))
const text = (b: Uint8Array) => Buffer.from(b).toString('latin1')

// Strings planted by the fixture recipe, none of which may survive.
const PLANTED = ['PLANT', '2019:01:02', '<x:xmpmeta', '<?xpacket', 'http://ns.adobe.com/xap/1.0/', 'Photoshop 3.0']
const PROMPT = 'plantedprompt'
// Orientation, ImageDescription, XPComment, the Exif pointer, UserComment.
const EXIF_ALLOWED = new Set([0x0112, 0x010e, 0x9c9c, 0x8769, 0x9286])

// Every TIFF structure anywhere in the bytes, and the tags in its IFD0 and
// Exif directory. Its own walker: shares no code with the stripper.
function tiffTags(b: Uint8Array): number[][] {
  const out: number[][] = []
  const s = text(b)
  for (const sig of ['MM\0*', 'II*\0']) {
    for (let at = s.indexOf(sig); at >= 0; at = s.indexOf(sig, at + 1)) {
      const dv = new DataView(b.buffer, b.byteOffset + at, b.length - at)
      const le = sig === 'II*\0'
      const tags: number[] = []
      const dir = (off: number) => {
        if (off + 2 > dv.byteLength) return
        const n = dv.getUint16(off, le)
        for (let k = 0; k < n && off + 2 + 12 * k + 12 <= dv.byteLength; k++) {
          const e = off + 2 + 12 * k
          const tag = dv.getUint16(e, le)
          tags.push(tag)
          if (tag === 0x8769 || tag === 0x8825) dir(dv.getUint32(e + 8, le))
        }
      }
      if (dv.byteLength >= 8) dir(dv.getUint32(4, le))
      out.push(tags)
    }
  }
  return out
}

// The input's picture data, located by the check's own reading of the format.
function pictureBytes(name: string, b: Uint8Array): Uint8Array[] {
  const s = text(b)
  if (name.endsWith('.png')) {
    const out: Uint8Array[] = []
    for (let at = s.indexOf('IDAT'); at >= 0; at = s.indexOf('IDAT', at + 1)) {
      const len = new DataView(b.buffer, b.byteOffset).getUint32(at - 4)
      out.push(b.subarray(at + 4, at + 4 + len))
    }
    return out
  }
  if (name.endsWith('.jpg')) {
    // The last scan to the end of image.
    const sos = s.lastIndexOf('\xff\xda')
    return [b.subarray(sos, s.lastIndexOf('\xff\xd9') + 2)]
  }
  if (name.endsWith('.webp')) {
    const at = s.indexOf('VP8L')
    const len = new DataView(b.buffer, b.byteOffset).getUint32(at + 4, true)
    return [b.subarray(at, at + 8 + len)]
  }
  if (name.endsWith('.gif')) {
    // The image descriptor and its LZW data, found by stepping over the
    // header, palette and every extension.
    let at = 13 + (b[10] & 0x80 ? 3 * (1 << ((b[10] & 7) + 1)) : 0)
    const subBlocks = (p: number) => { while (b[p]) p += 1 + b[p]; return p + 1 }
    while (b[at] === 0x21) at = subBlocks(at + 2)
    if (b[at] !== 0x2c) return [new Uint8Array(0)]
    const local = b[at + 9] & 0x80 ? 3 * (1 << ((b[at + 9] & 7) + 1)) : 0
    return [b.subarray(at, subBlocks(at + 10 + local + 1))]
  }
  return []
}

function contains(hay: Uint8Array, needle: Uint8Array): boolean {
  return Buffer.from(hay).indexOf(Buffer.from(needle)) >= 0
}

// What is wrong with `out` as the cleared form of fixture `name`.
function judge(name: string, input: Uint8Array, out: Uint8Array): string[] {
  const wrong: string[] = []
  const s = text(out)
  for (const p of PLANTED) if (s.includes(p)) wrong.push(`planted "${p}" survived`)
  for (const tags of tiffTags(out)) {
    const bad = tags.filter((t) => !EXIF_ALLOWED.has(t))
    if (bad.length) wrong.push(`EXIF holds tags ${bad.map((t) => '0x' + t.toString(16)).join(',')}`)
  }
  if (!name.endsWith('.avif') && !s.includes(PROMPT)) wrong.push('the prompt is gone')
  for (const pic of pictureBytes(name, input)) if (!pic.length || !contains(out, pic)) wrong.push('picture data changed')
  if (name.endsWith('.avif')) {
    // Blanked in place: same length, and every changed byte is now a zero
    // or a `free` box's name.
    if (out.length !== input.length) wrong.push('the AVIF changed length')
    for (let k = 0; k < out.length; k++) {
      if (out[k] === input[k] || out[k] === 0) continue
      if (!['free'].some((f) => s.slice(Math.max(0, k - 3), k + 4).includes(f))) {
        // Rewritten item tables shift inside meta; allow bytes inside meta.
        const meta = s.indexOf('meta')
        const metaEnd = meta - 4 + new DataView(out.buffer, out.byteOffset).getUint32(meta - 4)
        if (k < meta || k >= metaEnd) { wrong.push(`AVIF byte ${k} changed outside meta`); break }
      }
    }
  }
  return wrong
}

console.log('== every fixture is cleared, keeps its prompt and its picture')
for (const [key, b64] of Object.entries(FIXTURES)) {
  const name = 'in' + key
  const input = bytesOf(b64)
  const r = await stripIdentity(input)
  check(`${name}: not refused`, !r.refusal, r.refusal)
  check(`${name}: changed`, r.changed)
  const wrong = judge(name, input, r.bytes)
  check(`${name}: judged clean`, wrong.length === 0, wrong)
  const again = await stripIdentity(r.bytes)
  check(`${name}: stripping again changes nothing`, !again.changed && !again.refusal, again.dropped)
  const log = r.dropped.join(' ')
  check(`${name}: dropped names kinds, never content`, r.dropped.length > 0 && !/PLANT|plantedprompt|2019/.test(log), log)
  // The sabotage controls: the judge must see what it is there to see.
  check(`${name}: SABOTAGE unstripped input is judged dirty`, judge(name, input, input).some((w) => w.startsWith('planted') || w.startsWith('EXIF')))
  if (!name.endsWith('.avif')) {
    const wiped = Buffer.from(text(r.bytes).replaceAll(PROMPT, 'x'.repeat(PROMPT.length)), 'latin1')
    check(`${name}: SABOTAGE a lost prompt is judged`, judge(name, input, new Uint8Array(wiped)).includes('the prompt is gone'))
  }
}

console.log('== GPS and the camera are named as dropped')
{
  const r = await stripIdentity(bytesOf(FIXTURES['.jpg']))
  check('jpeg: GPS named', r.dropped.includes('jpeg:Exif GPS'), r.dropped)
  check('jpeg: XMP named', r.dropped.includes('jpeg:APP1 XMP'), r.dropped)
  check('jpeg: trailer named', r.dropped.includes('jpeg:bytes after the end'), r.dropped)
  const le = await stripIdentity(bytesOf(FIXTURES['-le.jpg']))
  const tags = tiffTags(le.bytes)
  check('little-endian EXIF is rewritten little-endian', text(le.bytes).includes('II*\0') && !text(le.bytes).includes('MM\0*'))
  check('little-endian EXIF keeps Orientation 3', tags.length === 1 && tags[0].includes(0x0112))
}

console.log('== AVIF: unlisted boxes are blanked, movie times zeroed')
{
  const isoBox = (type: string, body: Buffer) => {
    const h = Buffer.alloc(8)
    h.writeUInt32BE(8 + body.length)
    h.write(type, 4, 'latin1')
    return Buffer.concat([h, body])
  }
  // mvhd version 0: flags, creation and modification times, then the rest.
  const mvhd = Buffer.alloc(100)
  mvhd.writeUInt32BE(0x5c2c3e45, 4)
  mvhd.writeUInt32BE(0x5c2c3e46, 8)
  mvhd.writeUInt32BE(1000, 12)
  const moov = isoBox('moov', Buffer.concat([isoBox('mvhd', mvhd), isoBox('udta', Buffer.from('PLANTUDTA', 'latin1'))]))
  const input = new Uint8Array(Buffer.concat([Buffer.from(bytesOf(FIXTURES['.avif'])), moov, isoBox('uuid', Buffer.from('PLANTUUID-------', 'latin1'))]))
  const r = await stripIdentity(input)
  check('extended AVIF is cleared', !r.refusal && judge('in.avif', input, r.bytes).length === 0, r.refusal ?? judge('in.avif', input, r.bytes))
  const at = text(r.bytes).indexOf('mvhd')
  check('mvhd times are zero', at > 0 && Buffer.from(r.bytes).readUInt32BE(at + 8) === 0 && Buffer.from(r.bytes).readUInt32BE(at + 12) === 0)
  check('mvhd timescale is kept', at > 0 && Buffer.from(r.bytes).readUInt32BE(at + 16) === 1000)
  check('udta and uuid are named', r.dropped.includes('avif:udta') && r.dropped.includes('avif:uuid') && r.dropped.includes('avif:mvhd times'), r.dropped)
  // A data reference that is a URL, not "this file" (flag 1, empty body).
  let nest = isoBox('dref', Buffer.concat([Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), isoBox('url ', Buffer.from('\0\0\0\0http://x', 'latin1'))]))
  for (const outer of ['dinf', 'minf', 'mdia', 'trak', 'moov']) nest = isoBox(outer, nest)
  const remote = Buffer.concat([Buffer.from(bytesOf(FIXTURES['.avif'])), nest])
  const rr = await stripIdentity(new Uint8Array(remote))
  check('an AVIF pointing at data outside itself is refused', !!rr.refusal, rr.dropped)
}

console.log('== refusals carry a reason and a fix')
function ftyp(major: string, ...compat: string[]): Uint8Array {
  const body = Buffer.concat([Buffer.from(major, 'latin1'), Buffer.alloc(4), ...compat.map((c) => Buffer.from(c, 'latin1'))])
  const head = Buffer.alloc(8)
  head.writeUInt32BE(8 + body.length)
  head.write('ftyp', 4, 'latin1')
  return new Uint8Array(Buffer.concat([head, body]))
}
{
  const heic = await stripIdentity(ftyp('heic', 'mif1', 'heic'))
  check('HEIC is refused', !!heic.refusal && /HEIC/.test(heic.refusal.why), heic.refusal)
  check('HEIC refusal says how to get a JPEG', !!heic.refusal && /JPEG/.test(heic.refusal.fix) && /Most Compatible/.test(heic.refusal.fix))
  const err = new IdentityRefusal('IMG_0001.HEIC', heic.refusal!)
  const said = err.message
  check('the poster is told the file, why and the fix', said.includes('IMG_0001.HEIC') && said.includes(heic.refusal!.why) && said.includes(heic.refusal!.fix), said)
  const tiff = await stripIdentity(new Uint8Array(Buffer.from('II*\0\x08\0\0\0\0\0', 'latin1')))
  check('TIFF is refused', !!tiff.refusal)
  const junk = await stripIdentity(new Uint8Array(Buffer.from('not a picture at all', 'latin1')))
  check('an unknown format is refused', !!junk.refusal)
  const png = bytesOf(FIXTURES['.png'])
  const cut = await stripIdentity(png.subarray(0, png.length - 40))
  check('a PNG that stops short is refused', !!cut.refusal, cut.dropped)
  // An unknown CRITICAL chunk (upper-case first letter) cannot be dropped.
  const crit = Buffer.from(png)
  const at = text(crit).indexOf('tEXt')
  crit.write('QQQQ', at, 'latin1')
  const r = await stripIdentity(new Uint8Array(crit))
  check('a PNG with an unknown critical chunk is refused', !!r.refusal && r.refusal.why.includes('QQQQ'), r.refusal)
  const jpg = bytesOf(FIXTURES['.jpg'])
  const short = await stripIdentity(jpg.subarray(0, 600))
  check('a JPEG that stops short is refused', !!short.refusal)
}

console.log('== a clean file comes back as the very same bytes')
{
  const first = await stripIdentity(bytesOf(FIXTURES['.png']))
  const second = await stripIdentity(first.bytes)
  check('unchanged input is returned as is', second.bytes === first.bytes && second.dropped.length === 0)
}

if (failures) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nall identity strip checks passed')
