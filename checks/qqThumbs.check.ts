// QuickQueue's thumbnails kept in this browser (src/qq/thumbs.ts; operator
// 2026-11-23, "Yes, browser only"). Judged on an in-memory store and files
// that count their opens, so "no file was opened" is measured, not assumed.
// The real IndexedDB store (folderStore.ts browserThumbs) is driven in
// Chromium (tools/visual).

import { createThumbs, TOUCH_AFTER_MS, type StoredThumb, type ThumbStore } from '../src/qq/thumbs.ts'
import type { QqFileHandle } from '../src/qq/folderStore.ts'

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) {
    failures++
    if (detail !== undefined) console.log('       ', JSON.stringify(detail))
  }
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

interface MemStore extends ThumbStore {
  rows: Map<string, StoredThumb>
  gets: number
  puts: number
  failGet: boolean
  failPut: boolean
}
function memStore(): MemStore {
  const st: MemStore = {
    rows: new Map(), gets: 0, puts: 0, failGet: false, failPut: false,
    async getMany(keys) {
      st.gets++
      if (st.failGet) throw Object.assign(new Error('x'), { name: 'UnknownError' })
      const out = new Map<string, StoredThumb>()
      for (const k of keys) { const r = st.rows.get(k); if (r) out.set(k, r) }
      return out
    },
    async putMany(rows) {
      st.puts++
      if (st.failPut) throw Object.assign(new Error('x'), { name: 'QuotaExceededError' })
      for (const r of rows) st.rows.set(r.key, r)
    },
    async remove(key) { st.rows.delete(key) },
    async trim(maxBytes) {
      const byAge = [...st.rows.values()].sort((a, b) => a.at - b.at)
      let over = byAge.reduce((s, r) => s + r.blob.size, 0) - maxBytes
      for (const r of byAge) {
        if (over <= 0) break
        st.rows.delete(r.key)
        over -= r.blob.size
      }
    },
  }
  return st
}

let opens = 0
function fileHandle(name: string, size = 100, modified = 1000): QqFileHandle & { size: number; modified: number } {
  const h = {
    kind: 'file' as const, name, size, modified,
    getFile: async () => { opens++; return new File([new Uint8Array(h.size)], name, { lastModified: h.modified }) },
    createWritable: async () => { throw new Error('not here') },
  }
  return h
}

let renders = 0
let clock = 0
let urls = 0
const revoked: string[] = []
function thumbsOver(store: ThumbStore | null, extra: Partial<Parameters<typeof createThumbs>[0]> = {}) {
  return createThumbs({
    store,
    render: async (f) => { renders++; return new Blob([`thumb of ${f.name} ${f.size}`]) },
    makeUrl: () => `blob:${++urls}`,
    revokeUrl: (u) => { revoked.push(u) },
    saveDelayMs: 5,
    now: () => ++clock,
    ...extra,
  })
}
const yes = () => true

console.log('== a thumbnail made once is kept, and a reload opens no file for it')
{
  const store = memStore()
  const a = thumbsOver(store)
  const h = fileHandle('a.png')
  opens = 0; renders = 0
  const u1 = await a.thumbFor('1//a.png', h, yes)
  check('the first visit opens the file and makes it', opens === 1 && renders === 1, { opens, renders })
  check('it is shown at once from memory the next time', a.cachedThumb('1//a.png') === u1)
  await tick(20)
  check('it is saved in the store, with the file\'s size and time', store.rows.get('1//a.png')?.size === 100 && store.rows.get('1//a.png')?.modified === 1000)

  // A reload: a new page, the same browser store.
  const b = thumbsOver(store)
  opens = 0; renders = 0
  const u2 = await b.thumbFor('1//a.png', h, yes)
  check('after a reload it comes from the store: no file opened, nothing made', opens === 0 && renders === 0 && !!u2, { opens, renders })
  check('and then from memory', b.cachedThumb('1//a.png') === u2)
}

console.log('== the tiles of one frame are one store read')
{
  const store = memStore()
  const a = thumbsOver(store)
  const hs = Array.from({ length: 30 }, (_, i) => fileHandle(`p${i}.png`))
  await Promise.all(hs.map((h) => a.thumbFor(`1//${h.name}`, h, yes)))
  await tick(20)
  const b = thumbsOver(store)
  store.gets = 0; opens = 0
  await Promise.all(hs.map((h) => b.thumbFor(`1//${h.name}`, h, yes)))
  // Counted after the timers have all run: the tiles resolve on the first
  // read, and a read per tile would still be landing after them.
  await tick(20)
  check('30 tiles after a reload: one read, no file opened', store.gets === 1 && opens === 0, { gets: store.gets, opens })
  check('30 made in one scroll are saved in few writes, not 30', store.puts <= 2, store.puts)
}

console.log('== a tile scrolled away before its turn reads nothing')
{
  const store = memStore()
  const a = thumbsOver(store)
  opens = 0
  let err = ''
  await a.thumbFor('1//gone.png', fileHandle('gone.png'), () => false).catch((e) => { err = (e as Error).message })
  check('skipped, no open', err === 'skipped' && opens === 0, { err, opens })
  await tick(20)
  check('nothing saved for it', !store.rows.has('1//gone.png'))
}

console.log('== a picture replaced under the same name gets a new thumbnail when opened')
{
  const store = memStore()
  const a = thumbsOver(store)
  const h = fileHandle('r.png', 100, 1000)
  await a.thumbFor('1//r.png', h, yes)
  await tick(20)
  await a.fileOpened('1//r.png', new File([new Uint8Array(100)], 'r.png', { lastModified: 1000 }))
  check('opened unchanged: kept', store.rows.has('1//r.png') && a.cachedThumb('1//r.png') !== null)
  h.size = 200
  await a.fileOpened('1//r.png', await h.getFile())
  check('opened changed: dropped from the store and from memory', !store.rows.has('1//r.png') && a.cachedThumb('1//r.png') === null)
  renders = 0
  await a.thumbFor('1//r.png', h, yes)
  await tick(20)
  check('made again from the new file and saved with its size', renders === 1 && store.rows.get('1//r.png')?.size === 200, { renders, size: store.rows.get('1//r.png')?.size })

  // Opened before its save was written: the waiting row is dropped too.
  const c = thumbsOver(store, { saveDelayMs: 10_000 })
  const q = fileHandle('q.png', 100, 1000)
  await c.thumbFor('1//q.png', q, yes)
  q.modified = 2000
  await c.fileOpened('1//q.png', await q.getFile())
  await c.flush()
  check('a changed file opened before the save never saves the old thumbnail', !store.rows.has('1//q.png'))
}

console.log('== the store is bounded by bytes, least recently used first')
{
  const store = memStore()
  let t = 0
  const hundred = { render: async () => { renders++; return new Blob([new Uint8Array(100)]) }, storedBytes: 300, trimEvery: 1, now: () => t }
  const a = thumbsOver(store, hundred)
  for (const n of ['t1', 't2', 't3', 't4', 't5']) {
    t++
    await a.thumbFor(`1//${n}.png`, fileHandle(`${n}.png`), yes)
    await a.flush()
  }
  check('5 of 100 bytes made under 300: the 3 newest kept', [...store.rows.keys()].sort().join() === '1//t3.png,1//t4.png,1//t5.png', [...store.rows.keys()])

  // A week on, t3 is shown again (a reload): its time moves on, so the next
  // trim drops t4, which was not used, rather than t3.
  t += TOUCH_AFTER_MS + 1
  const b = thumbsOver(store, hundred)
  await b.thumbFor('1//t3.png', fileHandle('t3.png'), yes)
  await b.flush()
  check('shown after a week: its time is moved on', store.rows.get('1//t3.png')?.at === t, store.rows.get('1//t3.png')?.at)
  t++
  await b.thumbFor('1//t6.png', fileHandle('t6.png'), yes)
  await b.flush()
  check('the next trim drops the least recently used, not the one just shown', [...store.rows.keys()].sort().join() === '1//t3.png,1//t5.png,1//t6.png', [...store.rows.keys()])

  // Shown again within the week: no rewrite.
  const puts = store.puts
  const c = thumbsOver(store, hundred)
  await c.thumbFor('1//t3.png', fileHandle('t3.png'), yes)
  await c.flush()
  check('shown again within the week: nothing written', store.puts === puts, store.puts - puts)
}

console.log('== memory is bounded, and what is pushed out is revoked')
{
  revoked.length = 0
  const a = thumbsOver(null, { memoryMax: 2 })
  const u1 = await a.thumbFor('m1', fileHandle('m1.png'), yes)
  await a.thumbFor('m2', fileHandle('m2.png'), yes)
  await a.thumbFor('m3', fileHandle('m3.png'), yes)
  check('the oldest is revoked and forgotten', revoked.includes(u1) && a.cachedThumb('m1') === null && a.cachedThumb('m3') !== null, revoked)
}

console.log('== a store that fails still shows thumbnails, and says so once')
{
  const store = memStore()
  store.failGet = true
  store.failPut = true
  const a = thumbsOver(store)
  const told: string[] = []
  a.onProblem = (p) => told.push(p)
  renders = 0
  const u = await a.thumbFor('1//f.png', fileHandle('f.png'), yes)
  await a.thumbFor('1//g.png', fileHandle('g.png'), yes)
  await a.flush()
  check('made from the file all the same', !!u && renders === 2, renders)
  check('told once, naming the error and what happens instead', told.length === 1 && /UnknownError/.test(told[0]) && /made from the files/.test(told[0]), told)
}

console.log('== with no store (no folder access), thumbnails are made each visit')
{
  const a = thumbsOver(null)
  renders = 0
  await a.thumbFor('n', fileHandle('n.png'), yes)
  check('made, nothing kept', renders === 1)
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok')
process.exit(failures ? 1 : 0)
