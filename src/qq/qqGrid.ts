// ---------------------------------------------------------------------------
// QuickQueue's folder view, as decisions (tc.152 step 1).
//
// Everything here is pure, so checks/qqGrid drives it in node where there is
// no File System Access and no DOM. The panel (QuickQueuePanel.tsx) only asks.
//
// WHAT IS SHOWN. A folder lists its subfolders, then its images, each in
// natural name order (2.png before 10.png, the way Explorer sorts). Hidden
// entries -- a leading dot, such as the `.quickqueue/` index folder proposed in
// docs/design/QQ_FOLDER_INDEX.md -- are never shown. Files that are not
// pictures are counted, not shown, and the count is said, so a folder that
// looks empty is never silently full of something else.
//
// THE LISTING IS SHOWN WHOLE. The grid appears once the folder has been listed
// to the end, with a running count until then. Sorting a half-listed folder
// would move tiles under the reader's eyes as names arrived (memory
// no-forced-reflow-law); listing is the cheap half anyway (master reference
// sec 22.12-22.13: about a minute per 100,000 names over SMB on a PC).
// ---------------------------------------------------------------------------

/** The pictures the panel shows, by extension, with the type a Lightbox Save
 *  names them by. Lower-case keys; a name is matched case-insensitively. */
export const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
}

export function imageType(name: string): string | null {
  const m = /\.([a-z0-9]+)$/i.exec(name)
  if (!m) return null
  return IMAGE_TYPES[m[1].toLowerCase()] ?? null
}

export function isHidden(name: string): boolean {
  return name.startsWith('.')
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** Natural order, and a total one: names equal to the collator (case only)
 *  fall back to code-unit order, so a sort never depends on arrival order. */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0)
}

export interface ListedEntry<H = unknown> {
  name: string
  kind: 'directory' | 'file'
  handle: H
}

export interface Arranged<H = unknown> {
  dirs: ListedEntry<H>[]
  images: ListedEntry<H>[]
  /** Files listed that are not pictures (hidden ones excluded). */
  otherFiles: number
}

export function arrangeListing<H>(entries: readonly ListedEntry<H>[]): Arranged<H> {
  const dirs: ListedEntry<H>[] = []
  const images: ListedEntry<H>[] = []
  let otherFiles = 0
  for (const e of entries) {
    if (isHidden(e.name)) continue
    if (e.kind === 'directory') dirs.push(e)
    else if (imageType(e.name)) images.push(e)
    else otherFiles += 1
  }
  dirs.sort((a, b) => naturalCompare(a.name, b.name))
  images.sort((a, b) => naturalCompare(a.name, b.name))
  return { dirs, images, otherFiles }
}

// --- The windowed grid ------------------------------------------------------
//
// A folder can hold 100,000 pictures. Mounting a tile for each is a page that
// takes seconds to lay out and holds a node per file, so only the rows near
// the viewport exist; a spacer gives the scroll its full height. Tiles are
// square and every row is the same height, so where row r sits is arithmetic
// and nothing has to be measured.

export interface GridInput {
  count: number
  /** The scroller's inner width and height, in CSS px. */
  width: number
  height: number
  scrollTop: number
  /** The smallest a tile may be; tiles grow to fill the row exactly. */
  minTile: number
  gap: number
  /** Rows kept above and below the viewport, so a fling does not show holes. */
  overscanRows: number
}

export interface GridWindow {
  cols: number
  tile: number
  /** Tile plus gap: where row r starts is r * rowStep. */
  rowStep: number
  rows: number
  totalHeight: number
  /** Items [first, last) are mounted. */
  first: number
  last: number
}

export function gridWindow(g: GridInput): GridWindow {
  const width = Math.max(0, g.width)
  const gap = Math.max(0, g.gap)
  const minTile = Math.max(1, g.minTile)
  const cols = Math.max(1, Math.floor((width + gap) / (minTile + gap)))
  // Never below 1px: a panel squeezed to nothing must not divide by zero below.
  const tile = Math.max(1, Math.floor((width - gap * (cols - 1)) / cols))
  const rowStep = tile + gap
  const count = Math.max(0, Math.floor(g.count))
  const rows = Math.ceil(count / cols)
  const totalHeight = rows === 0 ? 0 : rows * rowStep - gap
  const top = Math.max(0, g.scrollTop)
  const over = Math.max(0, Math.floor(g.overscanRows))
  const firstRow = Math.max(0, Math.floor(top / rowStep) - over)
  const lastRow = Math.min(rows, Math.ceil((top + Math.max(0, g.height)) / rowStep) + over)
  return {
    cols,
    tile,
    rowStep,
    rows,
    totalHeight,
    first: Math.min(count, firstRow * cols),
    last: Math.min(count, Math.max(firstRow, lastRow) * cols),
  }
}

// --- The panel's height -----------------------------------------------------
//
// The panel takes its height from the chat above it. It may never take so much
// that the chat disappears (a reader must still see the room they are posting
// to), nor be dragged so small that it is only a title.

export const PANEL_MIN_PX = 160
/** What the chat keeps above an open panel, at least. */
export const CHAT_KEEP_PX = 200
export const PANEL_DEFAULT_SHARE = 0.45

/** `stored` is the height last dragged to, or null for none; `room` is the
 *  height the panel and the chat share. */
export function panelHeight(stored: number | null, room: number): number {
  const ceiling = Math.max(PANEL_MIN_PX, Math.floor(room - CHAT_KEEP_PX))
  const want = stored !== null && Number.isFinite(stored) ? stored : Math.round(room * PANEL_DEFAULT_SHARE)
  return Math.min(ceiling, Math.max(PANEL_MIN_PX, Math.round(want)))
}

// --- What the panel offers, for a folder -----------------------------------

export type FolderView =
  /** This browser has no File System Access (Firefox, Safari, Brave unless
   *  enabled): say so. Decided before anything is loaded, because nothing
   *  will ever load (the panel showed NOTHING here until 2026-11-19). */
  | 'unsupported'
  /** The remembered folders are still being read from this device. */
  | 'loading'
  /** No folder picked yet. */
  | 'pick'
  /** Picked before, and this browser session has not been granted it yet:
   *  one tap to reopen (Android Chrome after every restart, sec 22.13). */
  | 'reopen'
  /** The user refused access to it: say how to get it back. */
  | 'denied'
  | 'ready'

export type Permission = 'granted' | 'prompt' | 'denied'

/** `loaded`: the remembered folders have been read (or failed to be). The
 *  panel renders exactly what this returns, so every state, loading included,
 *  is one the checks can see. */
export function folderView(supported: boolean, loaded: boolean, picked: boolean, permission: Permission | null): FolderView {
  if (!supported) return 'unsupported'
  if (!loaded) return 'loading'
  if (!picked) return 'pick'
  if (permission === 'granted') return 'ready'
  if (permission === 'denied') return 'denied'
  // 'prompt', or a state not yet asked: never assume granted.
  return 'reopen'
}
