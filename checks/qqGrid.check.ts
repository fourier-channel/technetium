// QuickQueue's folder view as decisions (src/qq/qqGrid.ts): what a folder
// shows and in what order, which rows of a 100,000-picture folder are
// mounted, how tall the panel may be, and what it offers for a folder whose
// permission is in each state. All pure, so every edge is driven here.
import {
  arrangeListing, folderView, gridWindow, imageType, isHidden, naturalCompare, panelHeight,
  CHAT_KEEP_PX, PANEL_DEFAULT_SHARE, PANEL_MIN_PX, type ListedEntry,
} from '../src/qq/qqGrid.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

console.log('== which files are pictures')
for (const n of ['a.png', 'A.PNG', 'b.jpg', 'c.JPEG', 'd.webp', 'e.avif', 'f.gif', 'x.y.png']) {
  check(`${n} is a picture`, imageType(n) !== null)
}
for (const n of ['a.txt', 'png', 'a.png.txt', 'a.', '', 'notes.json', 'a.svg', 'a.heic']) {
  check(`${JSON.stringify(n)} is not`, imageType(n) === null)
}
check('jpg and jpeg are both image/jpeg', imageType('a.jpg') === 'image/jpeg' && imageType('a.jpeg') === 'image/jpeg')
check('a leading dot is hidden', isHidden('.quickqueue') && isHidden('.DS_Store'))
check('a dot inside the name is not', !isHidden('a.png'))

console.log('== natural order, and a total one')
const sorted = ['10.png', '2.png', '1.png', 'B.png', 'a.png', 'A.png'].sort(naturalCompare)
check('numbers sort as numbers', sorted.indexOf('2.png') < sorted.indexOf('10.png'), sorted)
check('case does not separate letters', Math.abs(sorted.indexOf('a.png') - sorted.indexOf('A.png')) === 1, sorted)
check('names equal but for case still have an order', naturalCompare('A.png', 'a.png') !== 0)
check('and that order is antisymmetric',
  Math.sign(naturalCompare('A.png', 'a.png')) === -Math.sign(naturalCompare('a.png', 'A.png')))
const shuffled = ['b', 'A', 'a', 'B', '10', '9'].map((n) => `${n}.png`)
check('the result never depends on arrival order',
  JSON.stringify([...shuffled].sort(naturalCompare)) === JSON.stringify([...shuffled].reverse().sort(naturalCompare)))

console.log('== a listing, arranged')
const e = (name: string, kind: 'file' | 'directory' = 'file'): ListedEntry<string> => ({ name, kind, handle: name })
const arranged = arrangeListing([
  e('10.png'), e('notes.txt'), e('sub10', 'directory'), e('.quickqueue', 'directory'), e('2.png'),
  e('sub2', 'directory'), e('.hidden.png'), e('readme.md'), e('3.JPG'),
])
check('folders first, in natural order', JSON.stringify(arranged.dirs.map((d) => d.name)) === '["sub2","sub10"]', arranged.dirs)
check('pictures in natural order', JSON.stringify(arranged.images.map((d) => d.name)) === '["2.png","3.JPG","10.png"]', arranged.images)
check('other files are counted, not shown', arranged.otherFiles === 2, arranged.otherFiles)
check('hidden entries are neither shown nor counted',
  !arranged.dirs.some((d) => d.name.startsWith('.')) && !arranged.images.some((d) => d.name.startsWith('.')))
check('a handle rides with its name', arranged.images[0].handle === '2.png')
const empty = arrangeListing([])
check('an empty folder arranges to nothing', empty.dirs.length === 0 && empty.images.length === 0 && empty.otherFiles === 0)

console.log('== the windowed grid')
const base = { count: 100_000, width: 600, height: 400, scrollTop: 0, minTile: 112, gap: 6, overscanRows: 3 }
const w0 = gridWindow(base)
check('columns fit the width at the minimum tile', w0.cols === 5, w0)
check('tiles grow to fill the row exactly', w0.cols * w0.tile + (w0.cols - 1) * base.gap <= base.width &&
  (w0.cols * (w0.tile + 1) + (w0.cols - 1) * base.gap) > base.width, w0)
check('every item has a row', w0.rows === Math.ceil(base.count / w0.cols))
check('the full height is rows of tiles less one gap', w0.totalHeight === w0.rows * w0.rowStep - base.gap)
check('at the top, item 0 is mounted', w0.first === 0)
check('and only a screen and some overscan of 100,000', w0.last - w0.first < 100 && w0.last > 0, w0)
const mid = gridWindow({ ...base, scrollTop: 50_000 })
check('deep in the folder the window moves with the scroll',
  mid.first > 0 && mid.first <= Math.floor(50_000 / mid.rowStep) * mid.cols && mid.last > mid.first, mid)
check('windows start on a row boundary', mid.first % mid.cols === 0)
const end = gridWindow({ ...base, scrollTop: w0.totalHeight })
check('scrolled to the end, the last item is mounted', end.last === base.count, end)
const over = gridWindow({ ...base, scrollTop: w0.totalHeight * 3 })
check('scrolled past the end, nothing out of range', over.first <= over.last && over.last <= base.count, over)
const narrow = gridWindow({ ...base, width: 50 })
check('narrower than one tile is still one column', narrow.cols === 1 && narrow.tile >= 1, narrow)
const zero = gridWindow({ ...base, width: 0, height: 0 })
check('a zero-size panel (pushed down) mounts almost nothing and divides by nothing',
  Number.isFinite(zero.tile) && zero.tile >= 1 && zero.last - zero.first <= (base.overscanRows + 1) * zero.cols, zero)
const none = gridWindow({ ...base, count: 0 })
check('an empty folder is zero tall and mounts nothing', none.totalHeight === 0 && none.first === 0 && none.last === 0, none)
const partial = gridWindow({ ...base, count: 7 })
check('a short last row still counts', partial.rows === 2 && partial.last === 7, partial)
check('a negative scroll is the top', gridWindow({ ...base, scrollTop: -500 }).first === 0)

console.log('== the panel height')
check('with nothing stored it takes its share', panelHeight(null, 1000) === Math.round(1000 * PANEL_DEFAULT_SHARE))
check('a stored height is kept when it fits', panelHeight(420, 1000) === 420)
check('never below the minimum', panelHeight(10, 1000) === PANEL_MIN_PX)
check('never so tall the chat is gone', panelHeight(5000, 1000) === 1000 - CHAT_KEEP_PX)
check('a tiny window still gets the minimum, not a negative', panelHeight(null, 100) === PANEL_MIN_PX)
check('a non-finite stored height is ignored', panelHeight(Number.NaN, 1000) === Math.round(1000 * PANEL_DEFAULT_SHARE))

console.log('== what the panel offers for a folder')
check('no File System Access: say so, whatever else', folderView(false, true, true, 'granted') === 'unsupported')
// The panel once rendered nothing at all in such a browser: it waited for a
// folder list that is never read when the API is missing (2026-11-19).
check('no File System Access: say so even before anything has loaded', folderView(false, false, false, null) === 'unsupported')
check('folders not read yet: loading, never the picker', folderView(true, false, false, null) === 'loading')
check('nothing picked: offer the picker', folderView(true, true, false, null) === 'pick')
check('granted: show it', folderView(true, true, true, 'granted') === 'ready')
check('denied: say how to get it back', folderView(true, true, true, 'denied') === 'denied')
check('prompt (Android after a restart): one tap to reopen', folderView(true, true, true, 'prompt') === 'reopen')
check('not yet asked is NEVER treated as granted', folderView(true, true, true, null) === 'reopen')

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nquickqueue grid: all checks passed')
