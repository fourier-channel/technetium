// QuickQueue's Scan (src/qq/scan.ts) against QQ_FOLDER_INDEX.md sec 7 in
// fourier-basis.
//
// The promises that matter to a user's library:
// - one getFile() and ONE read per file, unless the metadata runs past the
//   prefix: on the tablet each call costs 100-175 ms;
// - a prefix read learns exactly what a whole-file read would (judged by
//   brute force: every fixture, every prefix length, against the parser run on
//   the whole file);
// - a second scan reads nothing it already knows, and a moved file is not read
//   again;
// - what is learned is saved into the folder and reads back; a damaged own
//   segment is cut at the damage, never thrown away whole;
// - a folder QuickQueue may not write still scans, says so, and keeps its
//   index in this browser until the folder can hold it.
//
// The folder is an in-memory fake of the File System Access handles.
import { FIXTURES } from './qqPromptTags.fixtures.ts'
import { embeddedChunks, promptSource, promptToTags } from '../src/qq/promptTags.ts'
import { encodeSegment, mergeSegments, readSegment, segmentName, PARSER_VERSION, type QqiFile, type SegmentRead } from '../src/qq/qqi.ts'
import {
  FolderScan, INDEX_DIR, KEPT_IN_BROWSER, KEPT_LABEL, listTree, newestFirst, planScan, prefixSuffices, readEntry, readIndex,
  ONE_SCAN_AT_A_TIME, STALL_MS, stalled, type Merged,
} from '../src/qq/scan.ts'
import type { Keeper, QqDirHandle, QqFileHandle, QqWritable } from '../src/qq/folderStore.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

// --- the fake folder -------------------------------------------------------------

/** Image opens and reads (segment files excluded), and segment writes. */
const counts = { getFile: 0, reads: 0, writes: 0 }
function resetCounts() { counts.getFile = 0; counts.reads = 0; counts.writes = 0 }
const domError = (name: string) => new DOMException(name, name)

class FakeFile {
  readonly kind = 'file' as const
  /** Thrown by getFile(), once per name given (a permission lapse, a bad disk). */
  failGetFile: string[] = []
  /** Thrown by createWritable(). */
  failWrite: string | null = null
  name: string
  bytes: Uint8Array
  mtime: number
  constructor(name: string, bytes: Uint8Array, mtime = 1_763_000_000_000) { this.name = name; this.bytes = bytes; this.mtime = mtime }
  async getFile(): Promise<File> {
    const image = !this.name.endsWith('.qqi') // the index's own files are opened by design
    if (image) counts.getFile++
    const f = this.failGetFile.shift()
    if (f) throw domError(f)
    const bytes = this.bytes
    const blob = (from: number, to: number) => ({
      size: to - from,
      async arrayBuffer() { if (image) counts.reads++; return bytes.slice(from, to).buffer },
    })
    return {
      name: this.name, size: bytes.length, lastModified: this.mtime,
      slice: (a = 0, b = bytes.length) => blob(Math.max(0, a), Math.min(bytes.length, b)),
      arrayBuffer: () => blob(0, bytes.length).arrayBuffer(),
    } as unknown as File
  }
  async createWritable(opts?: { keepExistingData?: boolean }): Promise<QqWritable> {
    if (this.failWrite) throw domError(this.failWrite)
    let buf = opts?.keepExistingData ? this.bytes.slice() : new Uint8Array(0)
    let at = 0
    let open = true
    const self = this
    return {
      async seek(p) { at = p },
      async write(d) {
        counts.writes++
        const end = at + d.length
        if (end > buf.length) { const n = new Uint8Array(end); n.set(buf); buf = n }
        buf.set(d, at)
        at = end
      },
      async truncate(n) { buf = buf.slice(0, n); if (at > n) at = n },
      async close() { if (open) self.bytes = buf; open = false },
      async abort() { open = false },
    }
  }
}

class FakeDir {
  readonly kind = 'directory' as const
  children = new Map<string, FakeDir | FakeFile>()
  failList: string | null = null
  readOnly = false
  name: string
  constructor(name: string) { this.name = name }
  async isSameEntry(o: QqDirHandle) { return (o as unknown) === this }
  async queryPermission(): Promise<PermissionState> { return 'granted' }
  async requestPermission(): Promise<PermissionState> { return 'granted' }
  async *values() {
    if (this.failList) throw domError(this.failList)
    for (const c of this.children.values()) yield c as unknown as QqDirHandle | QqFileHandle
  }
  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<QqDirHandle> {
    let c = this.children.get(name)
    if (!c) {
      if (!opts?.create) throw domError('NotFoundError')
      if (this.readOnly) throw domError('NoModificationAllowedError')
      c = new FakeDir(name)
      this.children.set(name, c)
    }
    if (c.kind !== 'directory') throw domError('TypeMismatchError')
    return c as unknown as QqDirHandle
  }
  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<QqFileHandle> {
    let c = this.children.get(name)
    if (!c) {
      if (!opts?.create) throw domError('NotFoundError')
      if (this.readOnly) throw domError('NoModificationAllowedError')
      c = new FakeFile(name, new Uint8Array(0))
      this.children.set(name, c)
    }
    if (c.kind !== 'file') throw domError('TypeMismatchError')
    return c as unknown as QqFileHandle
  }
}

function put(root: FakeDir, path: string, bytes: Uint8Array): FakeFile {
  const parts = path.split('/')
  let d = root
  for (const p of parts.slice(0, -1)) {
    let c = d.children.get(p)
    if (!c) { c = new FakeDir(p); d.children.set(p, c) }
    d = c as FakeDir
  }
  const f = new FakeFile(parts[parts.length - 1], bytes)
  d.children.set(f.name, f)
  return f
}
function take(root: FakeDir, path: string): FakeFile {
  const parts = path.split('/')
  let d = root
  for (const p of parts.slice(0, -1)) d = d.children.get(p) as FakeDir
  const f = d.children.get(parts[parts.length - 1]) as FakeFile
  d.children.delete(f.name)
  return f
}
const asRoot = (d: FakeDir) => d as unknown as QqDirHandle

// --- images ------------------------------------------------------------------------

const be32 = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255)
const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff)
function cat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}
const chunk = (type: string, data: Uint8Array) => cat(be32(data.length), latin1(type), data, new Uint8Array(4))
const SIG = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)
/** A PNG with a prompt; `pad` bytes of private chunk before the text push it
 *  past a prefix; `pixels` bytes of image data after it. */
function pngWith(prompt: string, pad = 0, pixels = 2000) {
  return cat(SIG, chunk('IHDR', new Uint8Array(13)), pad ? chunk('prVt', new Uint8Array(pad)) : new Uint8Array(0),
    chunk('tEXt', cat(latin1('parameters'), Uint8Array.of(0), latin1(prompt + '\nSteps: 20'))),
    chunk('IDAT', new Uint8Array(pixels)), chunk('IEND', new Uint8Array(0)))
}

/** The judge: what the parser finds reading the WHOLE file. */
async function wholeFilePrompt(bytes: Uint8Array) {
  const s = promptSource(await embeddedChunks(bytes))
  if (!s.prompt) return null
  const t = promptToTags(s.prompt)
  return { generator: s.key, tags: t.tags, meta: t.meta, characters: t.characters }
}
const J = (x: unknown) => JSON.stringify(x)
// Tags are a set: the codec need not keep their order (as checks/qqi.check.ts).
const asSet = (p: { generator: string; tags: string[]; meta: string[]; characters: string[] } | null | undefined) =>
  p ? J([p.generator, [...p.tags].sort(), [...p.meta].sort(), [...p.characters].sort()]) : 'null'

// --- the prefix rule, brute force ------------------------------------------------------

console.log('== a prefix read learns what a whole-file read learns')
{
  let compared = 0
  const wrong: string[] = []
  for (const fx of FIXTURES) {
    const bytes = await fx.bytes()
    const want = J(await wholeFilePrompt(bytes))
    for (let n = 0; n <= bytes.length; n++) {
      const f = new FakeFile('x', bytes)
      const got = await readEntry('x', f as unknown as QqFileHandle, n)
      compared++
      if (J(got.record.prompt) !== want) { wrong.push(`${fx.name} @${n}`); break }
    }
  }
  check(`${FIXTURES.length} fixtures x every prefix length (${compared} reads): same prompt`, wrong.length === 0, wrong.slice(0, 5))
}
{
  // A long file whose metadata sits early: the prefix suffices.
  const png = pngWith('lantern, snow', 0, 200_000)
  resetCounts()
  const r = await readEntry('a.png', new FakeFile('a.png', png) as unknown as QqFileHandle)
  check('metadata in the prefix: one getFile, one read', counts.getFile === 1 && counts.reads === 1 && r.reads === 1, counts)
  check('...and the prompt is found', r.record.prompt?.tags.includes('lantern') === true, r.record.prompt)
  check('...and size and mtime are the file\'s', r.record.size === png.length && r.record.mtime === 1_763_000_000_000)

  const late = pngWith('harbor, gulls', 100_000, 200_000)
  resetCounts()
  const r2 = await readEntry('b.png', new FakeFile('b.png', late) as unknown as QqFileHandle)
  check('metadata past the prefix: a second, whole read', counts.getFile === 1 && counts.reads === 2 && r2.reads === 2, counts)
  check('...and the prompt is found', r2.record.prompt?.tags.includes('harbor') === true, r2.record.prompt)

  const small = pngWith('tiny', 0, 10)
  resetCounts()
  await readEntry('c.png', new FakeFile('c.png', small) as unknown as QqFileHandle)
  check('a file smaller than the prefix: one read', counts.reads === 1, counts)
}
{
  const webp = await FIXTURES.find((f) => f.name.startsWith('webp EXIF with Exif header'))!.bytes()
  check('webp: never sure from a part', prefixSuffices(webp.subarray(0, webp.length - 1)) === false)
  check('anything unrecognised: nothing to read, so sure', prefixSuffices(latin1('GIF89a......')) === true)
  check('a JPEG cut inside its Exif segment: not sure',
    prefixSuffices(cat(Uint8Array.of(0xff, 0xd8, 0xff, 0xe1, 0x01, 0x00), latin1('Exif'), Uint8Array.of(0, 0), new Uint8Array(20))) === false)
}

// --- order ------------------------------------------------------------------------------

console.log('== newest first, by name')
{
  const paths = ['old.png', '2026-11-21/9.png', '2026-11-22/ComfyUI_00009_.png', '2026-11-22/ComfyUI_00010_.png', 'b/x.png', '2026-11-22/sub/a.png']
  const got = [...paths].sort(newestFirst)
  const want = ['b/x.png', '2026-11-22/sub/a.png', '2026-11-22/ComfyUI_00010_.png', '2026-11-22/ComfyUI_00009_.png', '2026-11-21/9.png', 'old.png']
  check('dated folders and counters newest first; folders before loose files', J(got) === J(want), got)
}

// --- listing ------------------------------------------------------------------------------

console.log('== listing')
{
  const root = new FakeDir('root')
  put(root, 'a.png', pngWith('a'))
  put(root, 'notes.txt', latin1('not an image'))
  put(root, '.hidden.png', pngWith('h'))
  put(root, '.quickqueue/x.qqi', new Uint8Array(4))
  put(root, 'd/e/f.jpg', new Uint8Array(4))
  const bad = new FakeDir('locked')
  bad.failList = 'NotReadableError'
  root.children.set('locked', bad)
  resetCounts()
  const l = await listTree(asRoot(root))
  check('images only; hidden entries and the index skipped', J([...l.files.keys()].sort()) === J(['a.png', 'd/e/f.jpg']), [...l.files.keys()])
  check('listing opens no file', counts.getFile === 0)
  check('a folder that cannot be listed is said, not dropped', l.unlisted.length === 1 && l.unlisted[0].path === 'locked', l.unlisted)
  check('per-folder image counts', l.folders.get('') === 1 && l.folders.get('d/e') === 1 && l.folders.get('d') === 0)
  bad.failList = 'NotAllowedError'
  let threw = ''
  try { await listTree(asRoot(root)) } catch (e) { threw = (e as Error).name }
  check('a permission error ends the listing', threw === 'NotAllowedError')
}

console.log('== listing says where it is before a folder ends')
{
  // Found on the preview 2026-11-22: a big library sat at "0 files in 0
  // folders" for a minute, because the count moved only when a whole folder
  // was done. It reads as a hang.
  const root = new FakeDir('root')
  for (let i = 0; i < 5; i++) put(root, `big/${i}.png`, new Uint8Array(4))
  const calls: [number, number, string][] = []
  await listTree(asRoot(root), (l, f, at) => calls.push([l, f, at]))
  const inBig = calls.filter(([, , at]) => at === 'big')
  check('the count rises inside a folder, before it is done', J(inBig.map(([l]) => l).slice(0, 5)) === J([1, 2, 3, 4, 5]), calls)
  check('the folder being listed is named', calls.some(([, , at]) => at === 'big') && calls[0][2] === '', calls)

  const seen: { listed: number; folders: number; at: string }[] = []
  let t = 0
  const s = new FolderScan({
    root: asRoot(root), deviceId: 'dev-listing', locks: null, calibrate: 0, now: () => (t += 1000),
    onProgress: (p) => { if (p.phase === 'listing') seen.push({ listed: p.listed, folders: p.folders, at: p.listingIn }) },
  })
  await s.prepare()
  check('the scan reports files inside a folder not yet done', seen.some((x) => x.listed > 0 && x.listed < 5 && x.at === 'big'), seen)
}

// --- the plan ------------------------------------------------------------------------------

console.log('== the plan')
{
  const rec = (path: string): QqiFile => ({ kind: 'file', path, size: 1, mtime: 1, prompt: null, params: [] })
  const placed = (path: string, parserVersion = PARSER_VERSION) =>
    [path.normalize('NFC'), { record: rec(path), deviceId: 'd', writtenAt: 1, parserVersion, seq: 0 }] as const
  const merged: Merged = new Map([
    placed('kept.png'), placed('old-parser.png', PARSER_VERSION - 1),
    placed('a/moved.png'), placed('x/twin.png'), placed('y/twin.png'), placed('deleted.png'), placed('p/split.png'),
  ])
  const plan = planScan(['kept.png', 'old-parser.png', 'b/moved.png', 'z/twin.png', 'new.png', 'q/split.png', 'r/split.png'], merged)
  check('a known path is adopted', plan.adopted === 1)
  check('a record an older parser wrote is read again', plan.reparse === 1 && plan.toRead.includes('old-parser.png'))
  check('a unique name that vanished and appeared is a move', J(plan.moves) === J([{ from: 'a/moved.png', to: 'b/moved.png' }]))
  check('...written as a file at the new path and a gone at the old',
    plan.records.some((r) => r.kind === 'file' && r.path === 'b/moved.png') && plan.records.some((r) => r.kind === 'gone' && r.path === 'a/moved.png'))
  check('two vanished twins: no guess, the new one is read', plan.toRead.includes('z/twin.png'))
  check('one vanished, two appeared: no guess, both read', plan.toRead.includes('q/split.png') && plan.toRead.includes('r/split.png'))
  check('every other vanished path is gone', J([...plan.gone].sort()) === J(['deleted.png', 'p/split.png', 'x/twin.png', 'y/twin.png']), plan.gone)
  check('unknown names are read', plan.toRead.includes('new.png') && !plan.toRead.includes('kept.png'))
  check('the reads come newest first', J(plan.toRead) === J([...plan.toRead].sort(newestFirst)))
}

// --- a whole scan ----------------------------------------------------------------------------

const DEV = 'ab'.repeat(16)
const N = 40
function library() {
  const root = new FakeDir('root')
  for (let i = 0; i < N; i++) put(root, `2026-11-${String(10 + (i % 4))}/img_${i}.png`, pngWith(`tag${i}, lantern`))
  return root
}
async function ownSegment(root: FakeDir): Promise<SegmentRead> {
  const f = (root.children.get(INDEX_DIR) as FakeDir).children.get(segmentName(DEV)) as FakeFile
  const r = await readSegment(f.bytes, segmentName(DEV))
  if (!r.ok) throw new Error('segment refused: ' + r.reason)
  return r
}
async function indexOf(root: FakeDir) {
  const ix = await readIndex(asRoot(root))
  return mergeSegments(ix.segments)
}
const scan = (root: FakeDir, extra: Partial<ConstructorParameters<typeof FolderScan>[0]> = {}) =>
  new FolderScan({ root: asRoot(root), deviceId: DEV, locks: null, concurrency: 4, calibrate: 5, ...extra })

console.log('== declining the cost writes nothing')
{
  const root = library()
  resetCounts()
  const s = scan(root)
  const p = await s.prepare()
  s.stop()
  const after = s.progress()
  await new Promise((r) => setTimeout(r, 20))
  check('stopped at once, nothing waiting', after.phase === 'stopped' && after.unsaved === 0 && after.saved === 0, after)
  check('no index folder, no write', counts.writes === 0 && !root.children.has(INDEX_DIR), counts)
  check('the calibration had read files', p.read > 0)
}

console.log('== a first scan')
{
  const root = library()
  resetCounts()
  const s = scan(root)
  const p = await s.prepare()
  check('prepare stops at planned, with the cost stated', p.phase === 'planned' && p.toRead === N && p.read === 5 && p.etaSeconds !== null && p.addBytes > 0, p)
  check('prepare writes nothing', counts.writes === 0 && !root.children.has(INDEX_DIR))
  const done = await s.run()
  check('run reads the rest and is done', done.phase === 'done' && done.read === N && done.unsaved === 0 && done.saved === N, done)
  check(`one getFile and one read per file (${N})`, counts.getFile === N && counts.reads === N, counts)
  const ix = await indexOf(root)
  let same = 0
  for (const [, f] of take2(root)) {
    const e = ix.get(f.path.normalize('NFC'))
    if (e && asSet(e.record.prompt) === asSet(await wholeFilePrompt(f.bytes)) && e.record.size === f.bytes.length) same++
  }
  check('the segment reads back: every file, the whole-file prompt', ix.size === N && same === N, { size: ix.size, same })
  check('folder progress complete', [...s.folderProgress().values()].every((c) => c.done === c.images))

  console.log('== a second scan reads nothing it knows')
  resetCounts()
  const s2 = scan(root)
  const p2 = await s2.prepare()
  const imageReads = counts.getFile
  check('everything adopted, nothing to read, done at once', p2.phase === 'done' && p2.adopted === N && p2.toRead === 0, p2)
  check('no image opened', imageReads === 0, counts)
  check('nothing written', counts.writes === 0)

  console.log('== a move is not read again; a delete is gone')
  put(root, 'moved-here/img_3.png', take(root, '2026-11-13/img_3.png').bytes)
  take(root, '2026-11-10/img_4.png')
  resetCounts()
  const s3 = scan(root)
  const p3 = await s3.prepare()
  check('planned with one move and one gone, nothing to read', p3.phase === 'planned' && p3.moved === 1 && p3.gone === 1 && p3.toRead === 0, p3)
  const d3 = await s3.run()
  check('saved', d3.phase === 'done' && d3.saved === 3, d3)
  check('no image opened', counts.getFile === 0, counts)
  const ix3 = await indexOf(root)
  check('the index follows the move and the delete',
    ix3.has('moved-here/img_3.png') && !ix3.has('2026-11-13/img_3.png') && !ix3.has('2026-11-10/img_4.png') && ix3.size === N - 1)
  check('the moved entry keeps what was read',
    J(ix3.get('moved-here/img_3.png')?.record.prompt) === J(ix.get('2026-11-13/img_3.png')?.record.prompt))

  console.log('== a damaged own segment is cut at the damage')
  const segFile = (root.children.get(INDEX_DIR) as FakeDir).children.get(segmentName(DEV)) as FakeFile
  const before = (await ownSegment(root)).goodLength
  // Longer than the frame the next scan writes, so only a cut removes it.
  segFile.bytes = cat(segFile.bytes, new Uint8Array(5000).fill(0xa5))
  put(root, 'fresh/new.png', pngWith('fresh'))
  const s4 = scan(root)
  await s4.prepare()
  const d4 = await s4.run()
  const after = await ownSegment(root)
  check('the scan says what it cut', d4.problems.some((m) => m.includes('damaged after byte ' + before)), d4.problems)
  check('the segment reads whole again, nothing before the damage lost',
    after.stopped === null && (await indexOf(root)).size === N && (await indexOf(root)).has('fresh/new.png'), after.stopped)
}
function* take2(root: FakeDir, prefix = ''): Generator<[string, { path: string; bytes: Uint8Array }]> {
  for (const [name, c] of root.children) {
    const p = prefix ? `${prefix}/${name}` : name
    if (name.startsWith('.')) continue
    if (c.kind === 'directory') yield* take2(c, p)
    else yield [p, { path: p, bytes: c.bytes }]
  }
}

console.log('== flushes come in frames by count')
{
  const root = library()
  const s = scan(root, { flushRecords: 10, flushMs: 1e12 })
  await s.prepare()
  await s.run()
  const seg = await ownSegment(root)
  check('several frames, every record saved once', seg.frames.length >= 4 && seg.frames.reduce((n, f) => n + f.records.length, 0) === N, seg.frames.length)
}

console.log('== pause and resume read each file once')
{
  const root = library()
  resetCounts()
  let paused = false
  let t = 0 // progress is said at most every 200 ms of the scan's clock: this one moves 1 s a call
  const s = scan(root, { concurrency: 1, now: () => (t += 1000), onProgress: (p) => { if (!paused && p.phase === 'reading' && p.read === 15) { paused = true; s.pause() } } })
  await s.prepare()
  const mid = await s.run()
  check('paused part way, what was read saved', mid.phase === 'paused' && mid.read === 15 && mid.saved === 15 && mid.unsaved === 0, mid)
  const end = await s.run()
  check('resumed to done', end.phase === 'done' && end.read === N, end)
  check('each file read once', counts.getFile === N, counts)
}

console.log('== a lapsed permission pauses; the file is read on resume')
{
  const root = library()
  const victim = (root.children.get('2026-11-12') as FakeDir).children.get('img_2.png') as FakeFile
  victim.failGetFile = ['NotAllowedError']
  const s = scan(root, { calibrate: 0 })
  await s.prepare()
  const mid = await s.run()
  check('paused, and said', mid.phase === 'paused' && mid.problems.filter((m) => m.includes('stopped allowing')).length === 1, mid)
  const end = await s.run()
  const ix = await indexOf(root)
  check('resumed: every file indexed, none twice', end.phase === 'done' && ix.size === N && ix.has('2026-11-12/img_2.png') && end.read === N, end)
}

console.log('== an unreadable file is counted and said')
{
  const root = library()
  ;((root.children.get('2026-11-11') as FakeDir).children.get('img_1.png') as FakeFile).failGetFile = ['NotReadableError']
  const s = scan(root)
  await s.prepare()
  const d = await s.run()
  check('done, one unreadable, named', d.phase === 'done' && d.unreadable === 1 && d.problems.some((m) => m.includes('img_1.png')), d)
  check('not indexed, so the next scan tries it', !(await indexOf(root)).has('2026-11-11/img_1.png'))
  const fp = s.folderProgress()
  const hit = fp.get('2026-11-11')!
  check('its folder counts it as failed, not done', hit.failed === 1 && hit.done === hit.images - 1, hit)
  check('no other folder has a failure', [...fp].every(([f, c]) => f === '2026-11-11' || c.failed === 0))
}

console.log('== a folder QuickQueue may not write')
{
  const root = library()
  root.readOnly = true
  const s = scan(root)
  await s.prepare()
  const d = await s.run()
  check('the scan still reads everything', d.read === N && s.entries().size === N, d)
  check('nothing saved, and the user is told why', d.saved === 0 && d.unsaved === N && d.problems.some((m) => m.includes('may not write')), d)
  check('the message is said once', d.problems.filter((m) => m.includes('may not write')).length === 1, d.problems)
}

console.log('== a write that fails part way leaves the file as it was')
{
  const root = library()
  const s = scan(root, { flushRecords: 10, flushMs: 1e12 })
  await s.prepare()
  let n = 0
  const real = FakeFile.prototype.createWritable
  FakeFile.prototype.createWritable = async function (o) {
    if (this.name.endsWith('.qqi') && ++n === 2) throw domError('NotReadableError')
    return real.call(this, o)
  }
  const d = await s.run()
  FakeFile.prototype.createWritable = real
  check('the failed batch is retried, nothing lost', d.phase === 'done' && d.unsaved === 0 && (await indexOf(root)).size === N, d)
}

// --- the keeper: a folder's index kept in this browser ------------------------------

/** folderStore.ts browserKeeper, in memory: the same all-or-nothing writeAt. */
class FakeKeeper implements Keeper {
  bytes: Uint8Array | null = null
  failRead: string | null = null
  failWrite: string | null = null
  failDrop: string | null = null
  writes = 0
  drops = 0
  async read() {
    if (this.failRead) throw domError(this.failRead)
    return this.bytes ? this.bytes.slice() : null
  }
  async writeAt(offset: number, b: Uint8Array) {
    if (this.failWrite) throw domError(this.failWrite)
    const old = this.bytes ?? new Uint8Array(0)
    if (offset > old.length) throw new Error('a write past the end')
    this.bytes = cat(old.subarray(0, offset), b)
    this.writes++
  }
  async drop() {
    if (this.failDrop) throw domError(this.failDrop)
    this.bytes = null
    this.drops++
  }
}
async function keptSegment(k: FakeKeeper): Promise<SegmentRead> {
  const r = await readSegment(k.bytes ?? new Uint8Array(0))
  if (!r.ok) throw new Error('kept segment refused: ' + r.reason)
  return r
}
/** What a reader sees: the folder's segments and the keeper's, merged. */
async function everything(root: FakeDir, k: FakeKeeper) {
  const ix = await readIndex(asRoot(root))
  return mergeSegments(k.bytes ? [...ix.segments, await keptSegment(k)] : ix.segments)
}

console.log('== a folder QuickQueue may not write keeps its index in this browser')
{
  const root = library()
  root.readOnly = true
  const k = new FakeKeeper()
  const s = scan(root, { keeper: k, saveTo: 'browser', flushRecords: 10, flushMs: 1e12 })
  await s.prepare()
  const d = await s.run()
  check('read and saved, nothing waiting', d.phase === 'done' && d.read === N && d.saved === N && d.unsaved === 0, d)
  check('nothing written into the folder', !root.children.has(INDEX_DIR))
  const seg = await keptSegment(k)
  check('the keeper holds every file', (await everything(root, k)).size === N && seg.stopped === null)
  check('...under a device id of its own, not the folder segment\'s', seg.deviceId !== DEV && /^[0-9a-f]{32}$/.test(seg.deviceId), seg.deviceId)
  check('no problem said: the panel said it before go', d.problems.length === 0, d.problems)

  console.log('== a second scan of it reads nothing it knows')
  resetCounts()
  const writes = k.writes
  const p2 = await scan(root, { keeper: k, saveTo: 'browser' }).prepare()
  check('everything adopted from the keeper, done at once', p2.phase === 'done' && p2.adopted === N && p2.toRead === 0, p2)
  check('no image opened, nothing written', counts.getFile === 0 && k.writes === writes, { counts, writes: k.writes })

  console.log('== a new file is added to the same kept segment')
  put(root, 'fresh/one.png', pngWith('fresh'))
  const s3 = scan(root, { keeper: k, saveTo: 'browser' })
  await s3.prepare()
  const d3 = await s3.run()
  const seg3 = await keptSegment(k)
  check('one read, one saved', d3.phase === 'done' && d3.read === 1 && d3.saved === 1, d3)
  check('appended under the same id, nothing before it lost',
    seg3.deviceId === seg.deviceId && seg3.frames.length === seg.frames.length + 1 && (await everything(root, k)).size === N + 1)

  console.log('== a damaged keeper is cut at the damage, and said')
  const good = seg3.goodLength
  k.bytes = cat(k.bytes!, new Uint8Array(5000).fill(0xa5))
  put(root, 'fresh/two.png', pngWith('two'))
  const s4 = scan(root, { keeper: k, saveTo: 'browser' })
  await s4.prepare()
  const d4 = await s4.run()
  check('said where it was cut', d4.problems.some((m) => m.startsWith(KEPT_LABEL) && m.includes('damaged after byte ' + good)), d4.problems)
  const seg4 = await keptSegment(k)
  check('reads whole again; nothing before the damage lost', seg4.stopped === null && (await everything(root, k)).size === N + 2)

  console.log('== allowed to write later: Stop at the cost leaves the keeper alone')
  root.readOnly = false
  const kept = k.bytes!.slice()
  resetCounts()
  const s5 = scan(root, { keeper: k })
  const p5 = await s5.prepare()
  check('planned: nothing to read, the kept records to save', p5.phase === 'planned' && p5.toRead === 0 && p5.unsaved === N + 2, p5)
  s5.stop()
  await new Promise((r) => setTimeout(r, 20))
  check('nothing written, nothing dropped',
    !root.children.has(INDEX_DIR) && k.drops === 0 && J([...k.bytes!]) === J([...kept]) && counts.getFile === 0)

  console.log('== allowed to write: the keeper moves into the folder and is dropped')
  const s6 = scan(root, { keeper: k })
  await s6.prepare()
  const d6 = await s6.run()
  check('saved into the folder, no image opened', d6.phase === 'done' && d6.saved === N + 2 && counts.getFile === 0, { d6, counts })
  check('the keeper is dropped', k.bytes === null && k.drops === 1)
  const ix6 = await indexOf(root)
  check('the folder alone holds every file, with what was read', ix6.size === N + 2 && ix6.get('fresh/two.png')?.record.prompt?.tags.includes('two') === true)
  check('...in this device\'s own segment', (await ownSegment(root)).frames.reduce((n, f) => n + f.records.length, 0) === N + 2)
  const p7 = await scan(root, { keeper: k }).prepare()
  check('the next scan has nothing to do', p7.phase === 'done' && p7.adopted === N + 2 && p7.problems.length === 0, p7)
}

console.log('== a folder that refuses writes part way switches to the keeper, once')
{
  const root = library()
  const k = new FakeKeeper()
  const s = scan(root, { keeper: k, calibrate: 0, flushRecords: 10, flushMs: 1e12 })
  await s.prepare()
  let n = 0
  const real = FakeFile.prototype.createWritable
  FakeFile.prototype.createWritable = async function (o) {
    if (this.name.endsWith('.qqi') && ++n >= 2) throw domError('NoModificationAllowedError')
    return real.call(this, o)
  }
  const d = await s.run()
  FakeFile.prototype.createWritable = real
  check('done, nothing waiting', d.phase === 'done' && d.unsaved === 0 && d.saved === N, d)
  check('said once', d.problems.filter((m) => m === KEPT_IN_BROWSER).length === 1 && !d.problems.some((m) => m.includes('this tab only')), d.problems)
  const inFolder = (await indexOf(root)).size
  check('the first frame in the folder, the rest in the keeper, together everything',
    inFolder > 0 && inFolder < N && (await everything(root, k)).size === N, { inFolder })
  check('the keeper is kept: the folder does not hold it all', k.bytes !== null && k.drops === 0)
}

console.log('== a folder that refuses writes while the keeper moves keeps it, whole and once')
{
  const root = library()
  root.readOnly = true
  const k = new FakeKeeper()
  const a = scan(root, { keeper: k, saveTo: 'browser' })
  await a.prepare()
  await a.run()
  root.readOnly = false
  put(root, 'fresh/late.png', pngWith('late'))
  const s = scan(root, { keeper: k, calibrate: 0 })
  const p = await s.prepare()
  check('planned: the kept records to move, one to read', p.phase === 'planned' && p.unsaved === N && p.toRead === 1, p)
  const real = FakeFile.prototype.createWritable
  FakeFile.prototype.createWritable = async function () { throw domError('NoModificationAllowedError') }
  const d = await s.run()
  FakeFile.prototype.createWritable = real
  check('done, said once', d.phase === 'done' && d.unsaved === 0 && d.problems.filter((m) => m === KEPT_IN_BROWSER).length === 1, d)
  const seg = await keptSegment(k)
  const records = seg.frames.reduce((n, f) => n + f.records.length, 0)
  check('the keeper is not dropped', k.bytes !== null && k.drops === 0, { drops: k.drops })
  check('it holds every file, the kept ones not written twice', (await everything(root, k)).size === N + 1 && records === N + 1, { records })
}

console.log('== a keeper whose records the folder has all superseded is dropped at once')
{
  const root = library()
  const k = new FakeKeeper()
  root.readOnly = true
  const a = scan(root, { keeper: k, saveTo: 'browser', now: () => 1e12 })
  await a.prepare()
  await a.run()
  root.readOnly = false
  // A later scan of the same folder from a device with no keeper.
  const b = scan(root, { now: () => 2e12 })
  await b.prepare()
  await b.run()
  const c = scan(root, { keeper: k, now: () => 3e12 })
  const p = await c.prepare()
  check('nothing to move, nothing to do, the keeper dropped', p.phase === 'done' && p.unsaved === 0 && k.bytes === null && k.drops === 1, { p, drops: k.drops })
}

console.log('== kept records an older parser wrote are read again, not moved')
{
  const root = library()
  root.readOnly = true
  const k = new FakeKeeper()
  const a = scan(root, { keeper: k, saveTo: 'browser' })
  await a.prepare()
  await a.run()
  const seg = await keptSegment(k)
  k.bytes = await encodeSegment(seg.deviceId, seg.frames.map((f) => ({ ...f, parserVersion: PARSER_VERSION - 1 })))
  root.readOnly = false
  const p = await scan(root, { keeper: k, calibrate: 0 }).prepare()
  check('all read again, none moved, the stale keeper dropped',
    p.phase === 'planned' && p.toRead === N && p.unsaved === 0 && k.bytes === null, { p, kept: k.bytes?.length })
}

console.log('== a keeper that cannot store or be read is said')
{
  const root = library()
  root.readOnly = true
  const k = new FakeKeeper()
  k.failWrite = 'QuotaExceededError'
  const s = scan(root, { keeper: k, saveTo: 'browser' })
  await s.prepare()
  const d = await s.run()
  check('kept in the tab, said once', d.unsaved === N && d.saved === 0 && d.problems.filter((m) => m.includes('no room left')).length === 1, d)
  const k2 = new FakeKeeper()
  k2.failRead = 'UnknownError'
  const p = await scan(library(), { keeper: k2 }).prepare()
  check('an unreadable keeper is said, and the scan goes on', p.phase === 'planned' && p.problems.some((m) => m.startsWith(KEPT_LABEL + ' could not be read')), p)
  let threw = false
  try { scan(root, { saveTo: 'browser' }) } catch { threw = true }
  check('saving to the browser with no keeper is refused', threw)
}

console.log('== one scan at a time')
{
  const locks = { request: (_n: string, _o: unknown, cb: (l: unknown) => unknown) => Promise.resolve(cb(null)) } as unknown as LockManager
  const p = await scan(library(), { locks }).prepare()
  check('a second scan refuses, and says why', p.phase === 'failed' && p.problems.includes(ONE_SCAN_AT_A_TIME), p)
}

console.log('== the calendar draws folders while they are listed')
{
  // Found on the preview 2026-11-22: cells appeared only after the whole
  // tree was listed and the index read, so a big library showed none.
  const root = new FakeDir('root')
  for (let i = 0; i < 3; i++) put(root, `a/${i}.png`, new Uint8Array(4))
  for (let i = 0; i < 4; i++) put(root, `b/${i}.png`, new Uint8Array(4))
  let t = 0
  const during: string[] = []
  const s: FolderScan = scan(root, {
    calibrate: 0, now: () => (t += 1000),
    onProgress: (p) => {
      if (p.phase !== 'listing') return
      const f = s.folderProgress()
      during.push(J([...f].map(([k, c]) => [k, c.images, c.done]).sort()))
    },
  })
  await s.prepare()
  check('a folder has a cell before the listing ends', during.some((x) => x.includes('"b"') && !x.includes('"a"')) || during.some((x) => x.includes('"a"') && !x.includes('"b"')), during)
  check('a cell grows with its count while listed', during.some((x) => x.includes('["b",2,0]') || x.includes('["a",2,0]')), during)
  const end = s.folderProgress()
  check('after the plan the counts are the plan\'s', end.get('a')?.images === 3 && end.get('b')?.images === 4, [...end])
}

console.log('== Stop answers while a listing is wedged')
{
  // A folder whose listing never answers until released (a stalled share).
  const root = new FakeDir('root')
  put(root, 'a.png', pngWith('a'))
  const wedged = new FakeDir('wedged')
  let release: (e?: Error) => void = () => {}
  const gate = new Promise<void>((res, rej) => { release = (e) => (e ? rej(e) : res()) })
  const late = new FakeFile('late.png', new Uint8Array(4))
  wedged.values = async function* () { await gate; yield late as unknown as QqFileHandle }
  root.children.set('wedged', wedged)
  const k = new FakeKeeper()
  k.bytes = new Uint8Array(0)
  let last = ''
  resetCounts()
  const s = scan(root, { keeper: k, calibrate: 0, onProgress: (p) => { last = p.phase } })
  const done = s.prepare()
  await new Promise((r) => setTimeout(r, 20))
  check('the listing is wedged', last === 'listing', last)
  s.stop()
  check('Stop ends it at once', s.progress().phase === 'stopped' && last === 'stopped', s.progress().phase)
  release()
  const p = await done
  check('the late answer changes nothing', p.phase === 'stopped' && counts.writes === 0 && k.writes === 0 && k.drops === 0, { p: p.phase, w: counts.writes, k })
  check('the listing stops counting at the Stop, mid-folder', p.listed === 1, p.listed)

  const s2 = scan(root, { calibrate: 0 })
  const g2 = new Promise<void>((_, rej) => { release = (e) => rej(e) })
  wedged.values = async function* () { await g2; yield* [] as never[] }
  const done2 = s2.prepare()
  await new Promise((r) => setTimeout(r, 20))
  s2.stop()
  release(domError('NotAllowedError'))
  const p2 = await done2
  check('a late failure after Stop stays stopped and is not said', p2.phase === 'stopped' && p2.problems.length === 0, p2)
}

console.log('== Stop answers while the kept index is being read')
{
  const root = library()
  const k = new FakeKeeper()
  let release: () => void = () => {}
  const gate = new Promise<void>((res) => { release = res })
  k.read = async () => { await gate; return null }
  const phases: string[] = []
  let stoppedAt = -1
  const s = scan(root, { keeper: k, calibrate: 0, onProgress: (p) => { phases.push(p.phase) } })
  const done = s.prepare()
  await new Promise((r) => setTimeout(r, 20))
  check('the scan waits on the keeper', phases[phases.length - 1] === 'indexing', phases)
  s.stop()
  stoppedAt = phases.length
  release()
  await done
  const after = phases.slice(stoppedAt)
  check('after Stop no other phase is reported', after.length > 0 && after.every((x) => x === 'stopped'), phases)
}

console.log('== the stall watch')
check('a minute with no step while listing is a stall', stalled('listing', STALL_MS) && !stalled('listing', STALL_MS - 1))
check('reading is watched', stalled('reading', STALL_MS) && stalled('pausing', STALL_MS) && stalled('calibrating', STALL_MS) && stalled('indexing', STALL_MS))
check('waiting on the user is never a stall', !stalled('planned', 3_600_000) && !stalled('paused', 3_600_000) && !stalled('done', 3_600_000) && !stalled('stopped', 3_600_000))

process.exit(failures ? 1 : 0)
