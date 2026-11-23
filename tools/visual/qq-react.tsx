// See qq-react.html. Harness only -- never shipped.
// The order main.tsx uses: Compound's tokens FIRST, so the bridge's layer is
// declared after theirs and wins, as it does in the app.
import '@vector-im/compound-design-tokens/assets/web/css/compound-design-tokens.css'
import '../../src/index.css'
import '../../src/formant-tokens.css'
import '../../src/formant-bridge.css'
import { createRoot } from 'react-dom/client'
import { ClientContext } from '../../src/client/clientContextValue'
import { LightboxProvider } from '../../src/ui/Lightbox'
import { QuickQueueDrawer } from '../../src/qq/QuickQueueDrawer'

const errors: string[] = []
window.addEventListener('error', (e) => errors.push(String(e.message)))
window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)))
const params = new URLSearchParams(location.search)
const out = document.getElementById('result')!
let finished = false
const report = (lines: string[]) => { finished = true; out.textContent = lines.join('\n') }
// The capture helper gives up at 15 s and says only "never finished"; this
// says where it was instead.
let stage = 'start'
setTimeout(() => { if (!finished) report([`STUCK at: ${stage}`, `errors: ${errors.join(' / ') || 'none'}`]) }, 13000)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until<T>(what: string, fn: () => T | null | undefined | false, ms = 8000): Promise<T> {
  const t0 = performance.now()
  for (;;) {
    const v = fn()
    if (v) return v
    if (performance.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`)
    await sleep(50)
  }
}

// A PNG built by hand rather than drawn on a canvas: the headless shell runs
// without a GPU, and there OffscreenCanvas.convertToBlob hangs after a few
// encodes, which stalled this harness before any QuickQueue code ran. Each
// picture is its own colour with a white band at its own height, so tiles and
// the Lightbox can be told apart in a screenshot.
const PIC_W = 320
const PIC_H = 480
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}
function hueRgb(hue: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + hue / 30) % 12
    return Math.round(255 * (0.42 - 0.231 * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return [f(0), f(8), f(4)]
}
async function pngBytes(hue: number, band: number): Promise<Blob> {
  const [r, g, b] = hueRgb(hue)
  const raw = new Uint8Array((PIC_W * 3 + 1) * PIC_H)
  for (let y = 0; y < PIC_H; y++) {
    const row = y * (PIC_W * 3 + 1)
    const white = y >= band && y < band + 40
    for (let x = 0; x < PIC_W; x++) {
      raw[row + 1 + x * 3] = white ? 255 : r
      raw[row + 2 + x * 3] = white ? 255 : g
      raw[row + 3 + x * 3] = white ? 255 : b
    }
  }
  const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer())
  const ihdr = new Uint8Array(13)
  const hv = new DataView(ihdr.buffer)
  hv.setUint32(0, PIC_W)
  hv.setUint32(4, PIC_H)
  ihdr.set([8, 2, 0, 0, 0], 8)
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  return new Blob([sig, chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array())], { type: 'image/png' })
}

async function picture(dir: FileSystemDirectoryHandle, name: string, hue: number, n: number) {
  stage = `building: ${name}`
  const blob = await pngBytes(hue, (n * 53) % (PIC_H - 40))
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
  await w.write(blob)
  await w.close()
}

async function buildFolder(): Promise<FileSystemDirectoryHandle> {
  stage = 'building: opfs root'
  const opfs = await navigator.storage.getDirectory()
  // ?keep=1: the folder from the last load, as a reload finds it.
  if (params.get('keep') === '1') {
    try { return await opfs.getDirectoryHandle('qq-harness') } catch { /* first run: build it */ }
  }
  try { await opfs.removeEntry('qq-harness', { recursive: true }) } catch { /* first run */ }
  const dir = await opfs.getDirectoryHandle('qq-harness', { create: true })
  // Created out of order on purpose: the grid must show 1, 2, ... 40.
  const order = Array.from({ length: 40 }, (_, i) => i + 1).sort((a, b) => ((a * 7919) % 41) - ((b * 7919) % 41))
  for (const n of order) await picture(dir, `${n}.png`, (n * 37) % 360, n)
  const sub = await dir.getDirectoryHandle('sub folder', { create: true })
  await picture(sub, 'inner.png', 200, 5)
  await dir.getDirectoryHandle('.quickqueue', { create: true })
  const note = await (await dir.getFileHandle('notes.txt', { create: true })).createWritable()
  await note.write('not a picture')
  await note.close()
  return dir
}

async function run() {
  const dir = await buildFolder()
  stage = 'mounting'
  if (params.get('nofsa') === '1') {
    // A browser without File System Access (Firefox, Safari, Brave by default).
    delete (Window.prototype as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker
    delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker
  } else {
    ;(window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker =
      async () => dir
  }

  createRoot(document.getElementById('root')!).render(
    <ClientContext.Provider value={{ client: null, status: 'ready', error: null } as never}>
      <LightboxProvider>
        <div style={{ width: 900, height: 700, display: 'flex', flexDirection: 'column', borderRight: '1px solid #444' }}>
          <div style={{ flex: 1, minHeight: 0, padding: 12, color: '#999' }}>(the room timeline)</div>
          <QuickQueueDrawer />
          <div style={{ height: 24, borderTop: '1px solid #444', padding: '2px 12px', color: '#777' }}>(ticker)</div>
          <div style={{ height: 52, borderTop: '1px solid #444', padding: '6px 12px', color: '#777' }}>(composer)</div>
        </div>
      </LightboxProvider>
    </ClientContext.Provider>,
  )

  const facts: string[] = []
  const tab = await until('the tab', () => document.querySelector<HTMLButtonElement>('[data-target="quickqueue"]'))
  facts.push(`closed tab: pull=${tab.dataset.pull} open=${tab.dataset.open} label=${tab.getAttribute('aria-label') ?? tab.title}`)
  facts.push(`panel chunk loaded before opening: ${!!document.querySelector('.tc-qq')}`)
  // Where the tab sits against the panel's top edge (the drawer's top) and
  // whether its clip shows it: rounded px, so a reader can check each claim.
  const drawer = document.querySelector<HTMLElement>('.tc-qq-drawer')!
  const seat = () => {
    const t = tab.getBoundingClientRect()
    const edge = drawer.getBoundingClientRect().top
    const clip = tab.closest('.tc-tabclip')!.getBoundingClientRect()
    const visible = Math.max(0, Math.min(t.bottom, clip.bottom) - Math.max(t.top, clip.top))
    return `attach=${tab.dataset.attach} tabTop-edge=${Math.round(t.top - edge)} tabBottom-edge=${Math.round(t.bottom - edge)} visiblePx=${Math.round(visible)}`
  }
  facts.push(`closed seat: ${seat()}`)
  stage = 'opening the drawer'
  tab.click()
  await sleep(0)
  facts.push(`at the click: ${seat()}`)
  if (params.get('nofsa') === '1') {
    await sleep(800)
    const panel = await until('the panel', () => document.querySelector<HTMLElement>('.tc-qq'))
    facts.push(`open seat: ${seat()}`)
    facts.push(`view: ${panel.dataset.view}`)
    facts.push(`body says: ${document.querySelector('.tc-qq-body')?.textContent?.trim().slice(0, 90)}`)
    facts.push(`add-folder offered: ${[...panel.querySelectorAll('button')].some((b) => /folder/i.test(b.textContent ?? ''))}`)
    facts.push(`errors: ${errors.length ? errors.join(' / ') : 'none'}`)
    report(facts)
    return
  }
  const pick = await until('the pick button', () =>
    [...document.querySelectorAll<HTMLButtonElement>('.tc-qq-ask .tc-pill')].find((b) => /Pick a folder/.test(b.textContent ?? '')))
  stage = 'picking; waiting for thumbnails'
  pick.click()
  await until('image thumbnails', () => document.querySelectorAll('.tc-qq-cell[data-kind="image"] img').length >= 10, 12000)
  await sleep(600)
  const tile = document.querySelector<HTMLElement>('.tc-qq-tile')!
  const cells = [...document.querySelectorAll<HTMLElement>('.tc-qq-cell')]
  facts.push(`open tab: pull=${tab.dataset.pull} open=${tab.dataset.open}`)
  facts.push(`open seat: ${seat()}`)
  facts.push(`panel height: ${tile.getBoundingClientRect().height}px of a 700px column`)
  facts.push(`roots: ${[...document.querySelectorAll('.tc-qq-root')].map((r) => r.textContent).join(' | ')}`)
  facts.push(`count line: ${document.querySelector('.tc-qq-count')?.textContent}`)
  facts.push(`cells mounted: ${cells.length}; first 8: ${cells.slice(0, 8).map((c) => c.title).join(', ')}`)
  facts.push(`hidden .quickqueue shown: ${cells.some((c) => c.title === '.quickqueue')}`)
  facts.push(`thumbnails painted: ${document.querySelectorAll('.tc-qq-cell img').length}`)

  if (params.get('lightbox') === '1') {
    const first = cells.find((c) => c.dataset.kind === 'image')!
    stage = 'opening the lightbox'
    first.click()
    const img = await until('the lightbox picture', () =>
      document.querySelector<HTMLImageElement>('.mtags-stack > img[src^="blob:"]'), 4000).catch((e) => {
      const text = (document.body.innerText || '').replace(/\s+/g, ' ').slice(-300)
      throw new Error(`${(e as Error).message}; the page ends: ${text}`)
    })
    await until('the picture to decode', () => img.complete && img.naturalWidth > 0)
    facts.push(`lightbox: ${img.alt} ${img.naturalWidth}x${img.naturalHeight}`)
  } else if (params.get('sub') === '1') {
    cells.find((c) => c.dataset.kind === 'dir')!.click()
    await until('the subfolder', () => document.querySelector('.tc-qq-cell[title="inner.png"] img'), 8000)
    facts.push(`subfolder crumbs: ${document.querySelector('.tc-qq-crumbs')?.textContent}`)
  }
  if (params.get('close') === '1') {
    stage = 'closing the drawer'
    tab.click()
    await sleep(150)
    facts.push(`closing (150 ms in): ${seat()}`)
    await sleep(700)
    facts.push(`closed again: ${seat()}`)
  }
  facts.push(`errors: ${errors.length ? errors.join(' / ') : 'none'}`)
  report(facts)
}

run().catch((e) => report([`HARNESS FAILED: ${(e as Error).message}`, `errors: ${errors.join(' / ') || 'none'}`]))
