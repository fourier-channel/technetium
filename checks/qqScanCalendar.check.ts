// The Scan's calendar of cells (src/qq/scanCalendar.ts; QQ_FOLDER_INDEX.md
// sec 7a step 8). Pure, so judged here; the panel only draws it.

import { calendarTotals, cellState, scanCalendar } from '../src/qq/scanCalendar.ts'
import { newestFirst, type FolderCount } from '../src/qq/scan.ts'

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) {
    failures++
    if (detail !== undefined) console.log('       ', JSON.stringify(detail))
  }
}

const n = (images: number, done = 0, failed = 0): FolderCount => ({ images, done, failed })

console.log('== a cell\'s state')
check('nothing indexed is listed', cellState(n(10)) === 'listed')
check('some indexed is reading', cellState(n(10, 3)) === 'reading')
check('one failure alone is reading, not listed', cellState(n(10, 0, 1)) === 'reading')
check('all indexed is done', cellState(n(10, 10)) === 'done')
check('all tried with a failure is short', cellState(n(10, 9, 1)) === 'short')
check('all failed is short, not done', cellState(n(2, 0, 2)) === 'short')
check('one left to try is still reading', cellState(n(10, 8, 1)) === 'reading')

console.log('== rows by parent, newest first')
{
  const fp = new Map<string, FolderCount>([
    ['2025/2025-01', n(4, 4)],
    ['2026/2026-09', n(5)],
    ['2026/2026-11', n(6, 2)],
    ['2026/2026-10', n(7, 7)],
    ['2025/2025-12', n(3, 2, 1)],
    ['', n(2)],
    ['empty', n(0)],
  ])
  const rows = scanCalendar(fp, 'Outputs')
  check('three rows: 2026, 2025, then the root', JSON.stringify(rows.map((r) => r.label)) === '["2026","2025","Outputs"]', rows.map((r) => r.label))
  check('months newest first in a row',
    JSON.stringify(rows[0].cells.map((c) => c.name)) === '["2026-11","2026-10","2026-09"]', rows[0].cells.map((c) => c.name))
  check('2025 sorted too', JSON.stringify(rows[1].cells.map((c) => c.name)) === '["2025-12","2025-01"]', rows[1].cells.map((c) => c.name))
  check('states carried', JSON.stringify(rows[0].cells.map((c) => c.state)) === '["reading","done","listed"]')
  check('the short month is short', rows[1].cells[0].state === 'short')
  check('the root\'s loose pictures are a cell named for the root', rows[2].cells.length === 1 && rows[2].cells[0].name === 'Outputs' && rows[2].cells[0].folder === '')
  check('a folder with no pictures has no cell', rows.every((r) => r.cells.every((c) => c.folder !== 'empty')))
  check('counts carried', rows[0].cells[0].images === 6 && rows[0].cells[0].done === 2)
  const t = calendarTotals(rows)
  check('totals by state', t.listed === 2 && t.reading === 1 && t.done === 2 && t.short === 1, t)
}

console.log('== the root row: folders first, then its own loose pictures')
{
  const rows = scanCalendar(new Map([['', n(3)], ['b', n(1)], ['a', n(1)], ['c', n(1)]]), 'R')
  check('one row', rows.length === 1)
  check('folders newest first, root last', JSON.stringify(rows[0].cells.map((c) => c.folder)) === '["c","b","a",""]', rows[0].cells.map((c) => c.folder))
}

console.log('== deeper rows come before the row their parent is a cell in (the order the Scan reads)')
{
  const rows = scanCalendar(new Map([['2026/11', n(1)], ['2026/11/22', n(1)], ['2026/11/21', n(1)]]), 'R')
  check('days row above months row', JSON.stringify(rows.map((r) => r.parent)) === '["2026/11","2026"]', rows.map((r) => r.parent))
  check('days newest first', JSON.stringify(rows[0].cells.map((c) => c.name)) === '["22","21"]')
}

console.log('== a root holding dated folders and a year folder: rows in the order the Scan reaches them')
{
  // Found in Chromium 2026-11-22: rows sorted by parent path put "2025" above
  // the root's row, though the Scan reads the root's 2026 days first.
  const fp = new Map([
    ['2026-11-22', n(1)], ['2026-11-21', n(1)], ['2025/2025-12', n(1)], ['2025/2025-11', n(1)], ['', n(1)],
  ])
  const rows = scanCalendar(fp, 'R')
  check('the root row first, then 2025', JSON.stringify(rows.map((r) => r.label)) === '["R","2025"]', rows.map((r) => r.label))
  check('root row: days newest first, its loose pictures last',
    JSON.stringify(rows[0].cells.map((c) => c.folder)) === '["2026-11-22","2026-11-21",""]', rows[0].cells.map((c) => c.folder))
  // The same order the Scan reads files in.
  const files = ['2025/2025-11/a.png', 'a.png', '2026-11-21/a.png', '2025/2025-12/a.png', '2026-11-22/a.png']
  const scanOrder = [...new Set(files.sort(newestFirst).map((p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')))]
  const calendarOrder = rows.flatMap((r) => r.cells.map((c) => c.folder))
  check('rows first-cell order matches the Scan', scanOrder[0] === rows[0].cells[0].folder && scanOrder.indexOf('2025/2025-12') < scanOrder.indexOf(''),
    { scanOrder, calendarOrder })
}

console.log('== natural order, not text order')
{
  const rows = scanCalendar(new Map([['x/9', n(1)], ['x/10', n(1)], ['x/100', n(1)]]), 'R')
  check('100, 10, 9', JSON.stringify(rows[0].cells.map((c) => c.name)) === '["100","10","9"]', rows[0].cells.map((c) => c.name))
}

console.log('== nothing listed')
check('no rows', scanCalendar(new Map(), 'R').length === 0)

if (failures) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nall ok')
