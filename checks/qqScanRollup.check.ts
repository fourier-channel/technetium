// The Scan drawn on the folder tiles (src/qq/scanRollup.ts; QQ_FOLDER_INDEX.md
// sec 7a step 8). Pure, so judged here; the panel only draws it. The engine
// side (what lands in `listed` and when) is judged in qqScan.check.ts.

import { cellState, childTiles, subtreeOf, tileWords, type ScanFolders } from '../src/qq/scanRollup.ts'
import type { FolderCount } from '../src/qq/scan.ts'

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) {
    failures++
    if (detail !== undefined) console.log('       ', JSON.stringify(detail))
  }
}

const n = (images: number, done = 0, failed = 0): FolderCount => ({ images, done, failed })
const J = (x: unknown) => JSON.stringify(x)
const folders = (counts: [string, FolderCount][], listed: string[], unlisted: string[] = []): ScanFolders =>
  ({ counts: new Map(counts), listed: new Set(listed), unlisted })

console.log('== a tile\'s state from its counts')
check('nothing indexed is listed', cellState(n(10)) === 'listed')
check('some indexed is reading', cellState(n(10, 3)) === 'reading')
check('one failure alone is reading, not listed', cellState(n(10, 0, 1)) === 'reading')
check('all indexed is done', cellState(n(10, 10)) === 'done')
check('all tried with a failure is short', cellState(n(10, 9, 1)) === 'short')
check('all failed is short, not done', cellState(n(2, 0, 2)) === 'short')
check('one left to try is still reading', cellState(n(10, 8, 1)) === 'reading')

console.log('== a tile sums everything below it')
{
  const f = folders(
    [['', n(2)], ['2026', n(1, 1)], ['2026/11', n(3, 3)], ['2026/11/22', n(5, 2, 1)], ['2025/12', n(4, 4)], ['20261', n(7)]],
    ['2026', '2026/11', '2026/11/22', '2025', '2025/12', '20261'],
  )
  const t = childTiles(f, '')
  const y = t.get('2026')
  check('one tile per child, the root\'s own files on none', J([...t.keys()].sort()) === J(['2025', '2026', '20261']), [...t.keys()])
  check('2026 sums itself and every folder below', !!y && y.images === 9 && y.done === 6 && y.failed === 1 && y.state === 'reading', y)
  check('a name sharing a prefix is its own folder', t.get('20261')?.images === 7 && t.get('2026')?.images === 9)
  check('a child with only deeper folders still shows', t.get('2025')?.images === 4 && t.get('2025')?.state === 'done')
  const inner = childTiles(f, '2026')
  check('one level down: the month', J([...inner.keys()]) === J(['11']) && inner.get('11')?.images === 8, [...inner])
  check('and two', childTiles(f, '2026/11').get('22')?.images === 5)
  check('a leaf has no child tiles', childTiles(f, '2026/11/22').size === 0)
  check('subtreeOf agrees with the tile above it', J(subtreeOf(f, '2026')) === J(y), subtreeOf(f, '2026'))
  check('the root subtree is every count', subtreeOf(f, '')?.images === 22)
}

console.log('== a folder still being listed is never done')
{
  const f = folders([['a', n(3, 3)], ['a/b', n(2, 2)], ['c', n(2, 1, 1)]], ['a/b'])
  const t = childTiles(f, '')
  check('all read so far but listing: reading, marked so far', t.get('a')?.state === 'reading' && t.get('a')?.listing === true, t.get('a'))
  check('all tried so far but listing: reading, not short', t.get('c')?.state === 'reading' && t.get('c')?.listing === true, t.get('c'))
  check('its finished subfolder is done', childTiles(f, 'a').get('b')?.state === 'done' && !childTiles(f, 'a').get('b')?.listing)
  const g = folders([['a', n(3, 3)], ['a/b', n(2, 2)]], ['a', 'a/b'])
  check('once listed, done', childTiles(g, '').get('a')?.state === 'done')
  check('the words say so far while listing', tileWords(t.get('a')!).includes('still listing') && !tileWords(childTiles(g, '').get('a')!).includes('still listing'))
}

console.log('== nothing found shows nothing')
{
  const f = folders([['a', n(0)], ['b/c', n(0)]], ['a', 'b', 'b/c'])
  check('a folder with no pictures has no tile', childTiles(f, '').size === 0, [...childTiles(f, '')])
  check('nor a subtree', subtreeOf(f, 'b') === undefined)
  check('a folder never reached has no tile', childTiles(folders([], []), '').size === 0)
}

console.log('== a folder that could not be listed')
{
  const f = folders([['a', n(2, 2)], ['d', n(1, 1)]], ['a', 'a/x', 'd', 'e'], ['a/x', 'e'])
  const t = childTiles(f, '')
  check('its parent is short, though all found is read', t.get('a')?.state === 'short' && t.get('a')?.broken === true, t.get('a'))
  check('a sibling is not', t.get('d')?.state === 'done' && t.get('d')?.broken === false, t.get('d'))
  check('a broken folder with nothing found still shows, short', t.get('e')?.state === 'short' && t.get('e')?.images === 0, t.get('e'))
  check('inside, the broken folder shows short', childTiles(f, 'a').get('x')?.state === 'short')
  check('the words name it', tileWords(t.get('a')!).includes('could not be listed') && !tileWords(t.get('d')!).includes('could not be listed'))
  check('the root is short too, once it is listed', subtreeOf(folders([...f.counts], ['', ...f.listed], [...f.unlisted]), '')?.state === 'short')
  const g = folders([['a', n(2, 1, 1)]], ['a', 'a/x'], ['a/x'])
  check('unreadable files and an unlisted folder both said', tileWords(childTiles(g, '').get('a')!).includes('unreadable') && tileWords(childTiles(g, '').get('a')!).includes('could not be listed'))
  const h = folders([['a', n(2, 1)]], ['a/x'], ['a/x'])
  check('still listing, a broken folder below does not make it short yet', childTiles(h, '').get('a')?.state === 'reading')
}

process.exit(failures ? 1 : 0)
