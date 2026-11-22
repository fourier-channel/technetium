// The QuickQueue index segment codec (src/qq/qqi.ts) against its spec,
// QQ_FOLDER_INDEX.md sec 3c in fourier-basis.
//
// What matters most is not that bytes round-trip but the two promises the
// format makes to a user's library:
// - a damaged segment costs only what follows the damage, and never throws;
// - devices that compact their own segments AT THE SAME TIME never change what
//   the merged index shows for a listed path. That one is tested by brute
//   force: random segments on three devices, every subset of them compacting
//   against the same originals, and the merge compared before and after.
import { crc32 } from '../src/client/identityStrip.ts'
import {
  compactFrames, encodeSegment, mergeSegments, newDeviceId, pathKey, readSegment, sameContent,
  segmentName, SegmentWriter, MAGIC, PARSER_VERSION,
  type QqiFile, type QqiFrame, type QqiRecord, type SegmentRead,
} from '../src/qq/qqi.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const A = '0'.repeat(31) + '1'
const B = '0'.repeat(31) + '2'
const C = '0'.repeat(31) + '3'
const KANJI = '2026/11/\u7d05\u8449 caf\u00e9.png'
const md5 = (n: number) => new Uint8Array(16).fill(n)
const file = (path: string, over: Partial<QqiFile> = {}): QqiFile => ({
  kind: 'file', path, size: 1000, mtime: 1_763_000_000_000, params: [],
  prompt: { generator: 'parameters', tags: ['lantern', 'snow'], meta: ['masterpiece'], characters: [] },
  ...over,
})
const gone = (path: string): QqiRecord => ({ kind: 'gone', path })
const sorted = (l: string[]) => [...l].sort()
// The check's OWN idea of what a record says, independent of the codec's
// sameContent: a judge built from the code under test passes that code's bugs.
function canon(r: QqiRecord | null | undefined): string {
  if (!r) return 'none'
  if (r.kind === 'gone') return JSON.stringify(['gone', r.path])
  const p = r.prompt
  return JSON.stringify(['file', r.path, r.size, r.mtime, r.md5 ? [...r.md5] : null,
    p ? [p.generator, sorted(p.tags), sorted(p.meta), sorted(p.characters)] : null, r.params])
}
function sameRecord(a: QqiRecord | undefined, b: QqiRecord | undefined): boolean {
  return !!a && !!b && canon(a) === canon(b)
}
async function read(bytes: Uint8Array, name?: string): Promise<SegmentRead> {
  const r = await readSegment(bytes, name)
  if (!r.ok) throw new Error('refused: ' + r.reason)
  return r
}

// --- round trip ------------------------------------------------------------------

console.log('== a segment reads back as written')
const frame1: QqiRecord[] = [
  file('root.png'),
  file('2026/11/a.png', { md5: md5(7) }),
  file('2026/11/b.jpg', { prompt: null }),
  file(KANJI, {
    size: 2 ** 40 + 3, mtime: 2 ** 45 + 1,
    prompt: { generator: 'prompt', tags: ['zeta', 'alpha', 'lumen_(starfall)'], meta: [], characters: ['lumen_(starfall)'] },
    params: [['Sampler', 'Euler a'], ['Seed', '18446744073709551615']],
  }),
  gone('old/x.png'),
]
const frame2: QqiRecord[] = [
  file('2026/11/c.png', { prompt: { generator: 'parameters', tags: ['snow', 'lantern', 'new_tag'], meta: [], characters: [] } }),
]
const w = SegmentWriter.fresh(A)
const bytes1 = new Uint8Array([...w.header(), ...await w.frame(frame1, 1000), ...await w.frame(frame2, 2000)])
const r1 = await read(bytes1, segmentName(A))
check('read to the end, nothing stopped', r1.stopped === null && r1.goodLength === bytes1.length, r1.stopped)
check('device id from the header', r1.deviceId === A)
check('two frames, their times and parser version', r1.frames.length === 2 && r1.frames[0].writtenAt === 1000 &&
  r1.frames[1].writtenAt === 2000 && r1.frames[0].parserVersion === PARSER_VERSION)
const back = r1.frames.flatMap((f) => f.records)
const sent = [...frame1, ...frame2]
check('every record, in order, same path and content', back.length === sent.length && sent.every((s, i) => sameRecord(s, back[i])))
// Optional access throughout: a wrong decode must FAIL here, not crash the check.
const got = (i: number) => (back[i]?.kind === 'file' ? back[i] as QqiFile : undefined)
const big = got(3)
check('size and time past 2^32 survive', big?.size === 2 ** 40 + 3 && big?.mtime === 2 ** 45 + 1)
check('a non-ASCII path survives', big?.path === KANJI)
check('params survive in order', JSON.stringify(big?.params) === JSON.stringify(frame1[3].kind === 'file' && frame1[3].params))
check('tag lists come back as the same sets', JSON.stringify(sorted(big?.prompt?.tags ?? [])) === JSON.stringify(sorted(['zeta', 'alpha', 'lumen_(starfall)'])))
check('no MD5 stays no MD5, an MD5 stays itself', !!got(0) && !('md5' in got(0)!) && got(1)?.md5?.[0] === 7)
check('a file with no prompt reads back with none', got(2)?.prompt === null)
check('frame 2 reuses frame 1 strings: only new_tag is new',
  r1.strings.filter((s) => ['snow', 'lantern', 'parameters', 'new_tag'].includes(s)).length === 4 &&
  r1.strings.indexOf('new_tag') === r1.strings.length - 1)
check('folders are stored once each', r1.folders.length === 3, r1.folders)

console.log('== resuming an existing segment')
const w2 = SegmentWriter.resume(r1)
const f3 = await w2.frame([file('2026/11/d.png', { prompt: { generator: 'parameters', tags: ['snow'], meta: [], characters: [] } })], 500)
const bytes2 = new Uint8Array([...bytes1, ...f3])
const r2 = await read(bytes2)
check('the appended frame reads with the old tables', r2.stopped === null && r2.frames.length === 3 &&
  (r2.frames[2]?.records[0] as QqiFile | undefined)?.prompt?.tags[0] === 'snow', r2.stopped)
check('a clock that went backwards is raised to the last frame', r2.frames[2]?.writtenAt === 2000)
check('a resumed writer adds no duplicate string', r2.strings.length === r1.strings.length)

console.log('== encodeSegment equals a writer, and refuses bad input loudly')
const viaEncode = await encodeSegment(A, r1.frames)
check('same bytes as frame by frame', viaEncode.length === bytes1.length && viaEncode.every((b, i) => b === bytes1[i]))
let threw = 0
for (const bad of ['/abs.png', 'a//b.png', 'dir/', '']) {
  try { await SegmentWriter.fresh(A).frame([file(bad)], 1) } catch { threw++ }
}
check('absolute, empty-part and empty paths throw in the writer', threw === 4)
let idThrew = false
try { SegmentWriter.fresh('ABC') } catch { idThrew = true }
check('a malformed device id throws', idThrew)
check('newDeviceId is 32 hex digits and random', /^[0-9a-f]{32}$/.test(newDeviceId()) && newDeviceId() !== newDeviceId())

// --- damage ----------------------------------------------------------------------

console.log('== damage costs only what follows it')
const torn = await read(bytes2.subarray(0, bytes2.length - 1))
check('a truncated last frame: the frames before it stand', torn.frames.length === 2 && torn.stopped !== null &&
  torn.goodLength === bytes1.length, torn.stopped)
const flipped = bytes2.slice()
flipped[bytes2.length - 2] ^= 0xff
const crcBad = await read(flipped)
check('a flipped byte fails the CRC, earlier frames stand', crcBad.frames.length === 2 && /CRC/.test(crcBad.stopped ?? ''))
const tail = await read(new Uint8Array([...bytes2, 1, 2, 3]))
check('three stray bytes after the end: a torn frame header', tail.frames.length === 3 && /torn/.test(tail.stopped ?? ''))
const tornTwo = await read(bytes1.subarray(0, bytes1.length - 3))
check('a torn read gives back only the tables of whole frames', tornTwo.frames.length === 1 &&
  !tornTwo.strings.includes('new_tag') && r1.strings.includes('new_tag'))

// A frame that passes its CRC but does not decode: build the body by hand.
function uv(n: number): number[] { const o: number[] = []; while (n >= 0x80) { o.push((n % 0x80) | 0x80); n = Math.floor(n / 0x80) } o.push(n); return o }
async function rawFrame(body: number[]): Promise<Uint8Array> {
  const s = new Blob([new Uint8Array(body)]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  const packed = new Uint8Array(await new Response(s).arrayBuffer())
  const out = new Uint8Array(8 + packed.length)
  new DataView(out.buffer).setUint32(0, packed.length, true)
  new DataView(out.buffer).setUint32(4, crc32(packed), true)
  out.set(packed, 8)
  return out
}
const hdr = SegmentWriter.fresh(B).header()
const good = await SegmentWriter.fresh(B).frame([file('a.png')], 10)
const cases: [string, number[]][] = [
  ['a newer frame version', [...uv(2), ...uv(1), ...uv(5), 0, 0, 0]],
  ['a string id that names no string', [1, 1, 5, ...uv(1), 1, 120, ...uv(1), 0, 1, 0, 0, 1, 97, 0, 1, 1, 0, 9, 0, 0, 0]],
  ['a folder id that names no folder', [1, 1, 5, 0, 0, 1, 0, 4, 1, 97]],
  ['a count larger than the frame', [1, 1, 5, ...uv(1_000_000)]],
  ['invalid UTF-8 in a string', [1, 1, 5, 1, 2, 0xc3, 0x28, 0, 0]],
  ['bytes after the last record', [1, 1, 5, 0, 0, 0, 9]],
]
for (const [what, body] of cases) {
  const seg = await read(new Uint8Array([...hdr, ...good, ...await rawFrame(body)]))
  check(`${what}: stops there, the frame before stands`, seg.frames.length === 1 && seg.stopped !== null, seg.stopped)
}
const rolled = await read(new Uint8Array([...hdr, ...good, ...await rawFrame([1, 1, 5, 1, 1, 120, 0, 1, 0, 0, 1, 97])]))
check('a frame that fails part way adds nothing to the tables', rolled.strings.length === (await read(new Uint8Array([...hdr, ...good]))).strings.length)

console.log('== a file that is not a segment, or not this name, is refused whole')
const notMagic = await readSegment(new TextEncoder().encode('PNG not an index at all'))
check('wrong magic is refused with a reason', !notMagic.ok && /QQI1/.test(notMagic.reason))
check('too short to hold a header is refused', !(await readSegment(new TextEncoder().encode(MAGIC))).ok)
const renamed = await readSegment(bytes1, segmentName(B))
check('a header naming another device than the file name is refused', !renamed.ok && /second writer/.test(renamed.reason))
check('the matching name is read', (await readSegment(bytes1, segmentName(A))).ok)

console.log('== never throws on garbage')
let seed = 12345
const rand = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31 }
let fuzzThrew = 0
for (let i = 0; i < 300; i++) {
  const junk = new Uint8Array(Math.floor(rand() * 200))
  for (let k = 0; k < junk.length; k++) junk[k] = Math.floor(rand() * 256)
  const at = Math.floor(rand() * bytes2.length)
  const mutated = bytes2.slice()
  mutated.set(junk.subarray(0, Math.max(0, mutated.length - at)), at)
  try { await readSegment(new Uint8Array([...hdr, ...junk])); await readSegment(mutated) } catch { fuzzThrew++ }
}
check('600 damaged segments, none threw', fuzzThrew === 0, fuzzThrew)

// --- merging ---------------------------------------------------------------------

console.log('== merging segments')
const seg = (deviceId: string, ...frames: [number, QqiRecord[]][]) =>
  ({ deviceId, frames: frames.map(([writtenAt, records]) => ({ writtenAt, parserVersion: 1, records })) })
const big1 = file('p.png', { size: 1 })
const big2 = file('p.png', { size: 2 })
const sizeOf = (m: ReturnType<typeof mergeSegments>, p: string) => m.get(pathKey(p))?.record.size
check('the newest written-at wins', sizeOf(mergeSegments([seg(A, [20, [big1]]), seg(B, [10, [big2]])]), 'p.png') === 1)
check('on a tie, the higher device id wins', sizeOf(mergeSegments([seg(B, [10, [big1]]), seg(A, [10, [big2]])]), 'p.png') === 1)
check('within one device, the later record wins', sizeOf(mergeSegments([seg(A, [10, [big1, big2]])]), 'p.png') === 2)
check('a newer gone record leaves no entry', !mergeSegments([seg(A, [10, [big1]]), seg(B, [11, [gone('p.png')]])]).has('p.png'))
check('an older gone record does not hide a newer file', sizeOf(mergeSegments([seg(A, [12, [big1]]), seg(B, [11, [gone('p.png')]])]), 'p.png') === 1)
const nfd = 'cafe\u0301.png'
const nfc = 'caf\u00e9.png'
check('decomposed and composed names are one path',
  sizeOf(mergeSegments([seg(A, [10, [file(nfd, { size: 1 })]]), seg(B, [11, [file(nfc, { size: 2 })]])]), nfc) === 2 &&
  mergeSegments([seg(A, [10, [file(nfd)]]), seg(B, [11, [file(nfc)]])]).size === 1)

console.log('== what counts as the same content')
const base = file('p.png', { md5: md5(1) })
check('tag order does not matter', sameContent(base, file('p.png', { md5: md5(1), prompt: { ...base.prompt!, tags: ['snow', 'lantern'] } })))
check('a different MD5 is different', !sameContent(base, file('p.png', { md5: md5(2) })))
check('MD5 present against absent is different', !sameContent(base, file('p.png')))
check('a different tag is different', !sameContent(base, file('p.png', { md5: md5(1), prompt: { ...base.prompt!, tags: ['snow', 'moon'] } })))
check('a different size is different', !sameContent(base, file('p.png', { md5: md5(1), size: 2 })))
check('a different param is different', !sameContent(base, file('p.png', { md5: md5(1), params: [['Seed', '1']] })))
check('file against gone is different', !sameContent(base, gone('p.png')))

// --- compaction ------------------------------------------------------------------

console.log('== compaction, case by case')
const ALL = new Set(['p.png', 'q.png'])
const recs = (fs: QqiFrame[]) => fs.flatMap((f) => f.records)
check('a file no longer listed is dropped', recs(compactFrames(seg(A, [1, [big1]]), [], new Set())).length === 0)
check('a listed file nobody else has is kept', recs(compactFrames(seg(A, [1, [big1]]), [], ALL)).length === 1)
check('only the newest of my own records for a path is kept',
  recs(compactFrames(seg(A, [1, [big1]], [2, [big2]]), [], ALL)).map((r) => (r as QqiFile).size).join() === '2')
check('a gone record no other segment answers is dropped', recs(compactFrames(seg(A, [1, [gone('p.png')]]), [], ALL)).length === 0)
check('a gone record over an older file elsewhere is kept',
  recs(compactFrames(seg(B, [5, [gone('p.png')]]), [seg(A, [1, [big1]])], ALL)).length === 1)
check('superseded by a different newer record: dropped',
  recs(compactFrames(seg(A, [1, [big1]]), [seg(B, [5, [big2]])], ALL)).length === 0)
check('a duplicate is dropped by the HIGHER id only',
  recs(compactFrames(seg(B, [5, [big1]]), [seg(A, [1, [big1]])], ALL)).length === 0 &&
  recs(compactFrames(seg(A, [1, [big1]]), [seg(B, [5, [big1]])], ALL)).length === 1)
const kept = compactFrames(seg(A, [7, [file('p.png')]], [9, [file('q.png')]]), [], ALL)
check('kept records keep their own written-at, in order', kept.map((f) => f.writtenAt).join() === '7,9')

console.log('== compaction at the same time on every subset of devices never changes a listed path')
const DEVICES = [A, B, C]
const PATHS = ['p.png', 'q.png', 'dir/r.png', 'dir/s.png']
const CONTENTS: (() => QqiRecord)[] = [
  () => file('', { size: 1 }), () => file('', { size: 2 }), () => file('', { size: 1, md5: md5(1) }),
  () => file('', { size: 1, prompt: { generator: 'parameters', tags: ['lantern', 'moon'], meta: ['masterpiece'], characters: [] } }),
  () => gone(''),
]
const shown = (m: ReturnType<typeof mergeSegments>, p: string) => {
  const e = m.get(pathKey(p))
  return e ? e.record : null
}
let trials = 0
let broken = 0
let firstBroken: unknown = null
let encodeMismatch = 0
for (let t = 0; t < 400; t++) {
  const segs = DEVICES.map((deviceId) => {
    const frames: QqiFrame[] = []
    let at = 0
    for (let f = Math.floor(rand() * 4); f > 0; f--) {
      at += Math.floor(rand() * 3)
      const records: QqiRecord[] = []
      for (let n = 1 + Math.floor(rand() * 3); n > 0; n--) {
        const r = CONTENTS[Math.floor(rand() * CONTENTS.length)]()
        r.path = PATHS[Math.floor(rand() * PATHS.length)]
        records.push(r)
      }
      frames.push({ writtenAt: at, parserVersion: 1, records })
    }
    return { deviceId, frames }
  })
  const listed = new Set(PATHS.filter(() => rand() < 0.75))
  const before = mergeSegments(segs)
  for (let mask = 1; mask < 8; mask++) {
    trials++
    const after = segs.map((s, i) => (mask & (1 << i) ? { deviceId: s.deviceId, frames: compactFrames(s, segs, listed) } : s))
    const merged = mergeSegments(after)
    for (const p of listed) {
      if (canon(shown(before, p)) !== canon(shown(merged, p))) {
        broken++
        firstBroken ??= { t, mask, p, segs: JSON.stringify(segs), listed: [...listed] }
      }
    }
    if (t % 20 === 0) {
      for (const s of after) {
        const r = await read(await encodeSegment(s.deviceId, s.frames))
        const same = r.frames.length === s.frames.length &&
          r.frames.every((f, i) => f.writtenAt === s.frames[i].writtenAt && f.records.length === s.frames[i].records.length && f.records.every((x, k) => sameRecord(x, s.frames[i].records[k])))
        if (!same) encodeMismatch++
      }
    }
  }
}
check(`${trials} compaction scenarios: every listed path shows what it showed`, broken === 0, firstBroken)
check('compacted segments round-trip through the codec', encodeMismatch === 0, encodeMismatch)

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
