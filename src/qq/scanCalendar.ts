import { newestFirst, type FolderCount } from './scan'

// ---------------------------------------------------------------------------
// The picture of a Scan (QQ_FOLDER_INDEX.md sec 7a step 8, operator
// 2026-11-22): a calendar of cells, as sampling's calendar does for the
// archive. One cell per folder that holds pictures, all shown at once and
// coloured by state. Cells sit in rows by their parent folder, newest first,
// so a dated library reads as years down and months across, and the Scan,
// which reads newest first too, fills it from the top left.
//
// Pure: the panel draws what this returns.
// ---------------------------------------------------------------------------

/**
 * - listed: nothing in it is indexed yet;
 * - reading: some of it is;
 * - done: all of it is;
 * - short: everything was tried, and some files could not be read.
 */
export type CellState = 'listed' | 'reading' | 'done' | 'short'

export interface CalendarCell {
  /** The folder's path below the root; '' is the root itself. */
  folder: string
  /** What the cell is called: the folder's own name, or the root's. */
  name: string
  images: number
  done: number
  failed: number
  state: CellState
}

export interface CalendarRow {
  /** The parent folder's path below the root; '' is the root. */
  parent: string
  /** The row's label: that path, or the root's name. */
  label: string
  cells: CalendarCell[]
}

export function cellState(c: FolderCount): CellState {
  if (c.done >= c.images) return 'done'
  if (c.done + c.failed >= c.images) return 'short'
  if (c.done + c.failed === 0) return 'listed'
  return 'reading'
}

function split(folder: string): { parent: string; name: string } {
  const i = folder.lastIndexOf('/')
  return i < 0 ? { parent: '', name: folder } : { parent: folder.slice(0, i), name: folder.slice(i + 1) }
}

export function scanCalendar(folders: ReadonlyMap<string, FolderCount>, rootName: string): CalendarRow[] {
  const rows = new Map<string, CalendarCell[]>()
  for (const [folder, c] of folders) {
    if (c.images <= 0) continue
    // The root's own loose pictures sit in the root's row, beside its folders.
    const { parent, name } = folder === '' ? { parent: '', name: rootName } : split(folder)
    const cell: CalendarCell = { folder, name, images: c.images, done: c.done, failed: c.failed, state: cellState(c) }
    const row = rows.get(parent)
    if (row) row.push(cell)
    else rows.set(parent, [cell])
  }
  // Cells, and rows by their first cell, in the order the Scan reaches them,
  // so it fills the calendar from the top left. The Scan reads files in
  // newestFirst order of their full paths; a cell is reached at its first
  // file, which sorts as the folder's path plus an empty file name (the
  // root's own files: just the empty name). So a folder's subfolders come
  // before its own loose pictures, a row of days sits above the row its
  // month is a cell in, and a root holding both dated folders and a year
  // folder puts its own row first when its dates are newer.
  const reached = (folder: string) => (folder === '' ? '' : folder + '/')
  const byScan = (a: CalendarCell, b: CalendarCell) => newestFirst(reached(a.folder), reached(b.folder))
  return [...rows]
    .map(([parent, cells]) => ({ parent, label: parent === '' ? rootName : parent, cells: cells.sort(byScan) }))
    .sort((a, b) => byScan(a.cells[0], b.cells[0]))
}

/** Totals across every cell, for the line above the calendar. */
export function calendarTotals(rows: CalendarRow[]): Record<CellState, number> {
  const t: Record<CellState, number> = { listed: 0, reading: 0, done: 0, short: 0 }
  for (const r of rows) for (const c of r.cells) t[c.state]++
  return t
}
