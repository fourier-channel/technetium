import type { FolderCount } from './scan'

// ---------------------------------------------------------------------------
// A Scan drawn on the folders themselves (QQ_FOLDER_INDEX.md sec 7a step 8,
// operator 2026-11-22): the picture view stays the picture view, the picked
// folder's Scan sits in its header, and each folder tile carries the state of
// everything below it. This turns the engine's per-folder counts into what
// one tile shows.
//
// Pure: the panel draws what this returns.
// ---------------------------------------------------------------------------

/**
 * - listed: nothing in it is indexed yet;
 * - reading: some of it is, or its listing has not finished;
 * - done: all of it is, and all of it was listed;
 * - short: everything was tried, and some files could not be read or some
 *   folder in it could not be listed.
 */
export type CellState = 'listed' | 'reading' | 'done' | 'short'

/** What the engine knows of each folder, as the panel keeps it. */
export interface ScanFolders {
  /** Per folder ('' the root): its OWN pictures, not those below it. */
  counts: ReadonlyMap<string, FolderCount>
  /** Folders whose listing, and the listing of every folder below them, has
   *  finished. A folder not in here may still turn up more pictures. */
  listed: ReadonlySet<string>
  /** Folders that could not be listed. */
  unlisted: readonly string[]
}

export interface TileProgress extends FolderCount {
  state: CellState
  /** Its listing has not finished: the counts are so far. */
  listing: boolean
  /** Some folder in it could not be listed. */
  broken: boolean
}

export function cellState(c: FolderCount): CellState {
  if (c.done >= c.images) return 'done'
  if (c.done + c.failed >= c.images) return 'short'
  if (c.done + c.failed === 0) return 'listed'
  return 'reading'
}

const below = (folder: string, path: string) => folder === '' || path === folder || path.startsWith(folder + '/')

function tile(sum: FolderCount, complete: boolean, broken: boolean): TileProgress | undefined {
  // A folder nothing was found in yet shows nothing, unless part of it could
  // not be listed: then it is short, never silently empty.
  if (sum.images <= 0 && !(complete && broken)) return undefined
  let state = sum.images > 0 ? cellState(sum) : 'short'
  // Done or short is a claim about the whole folder; while it is still being
  // listed, more may turn up, so it is reading at most.
  if (!complete && (state === 'done' || state === 'short')) state = 'reading'
  if (complete && broken && state === 'done') state = 'short'
  return { ...sum, state, listing: !complete, broken }
}

/** One folder and everything below it; undefined shows nothing. */
export function subtreeOf(s: ScanFolders, folder: string): TileProgress | undefined {
  const sum: FolderCount = { images: 0, done: 0, failed: 0 }
  for (const [f, c] of s.counts) {
    if (!below(folder, f)) continue
    sum.images += c.images
    sum.done += c.done
    sum.failed += c.failed
  }
  return tile(sum, s.listed.has(folder), s.unlisted.some((u) => below(folder, u)))
}

/** For each folder directly inside `folder`, by its name: that folder and
 *  everything below it. A name with nothing to show is absent. One pass over
 *  the counts, so a big library costs one walk per redraw, not one per tile. */
export function childTiles(s: ScanFolders, folder: string): Map<string, TileProgress> {
  const prefix = folder === '' ? '' : folder + '/'
  const childOf = (path: string): string | null => {
    if (!path.startsWith(prefix) || path.length === prefix.length) return null
    const rest = path.slice(prefix.length)
    const i = rest.indexOf('/')
    return i < 0 ? rest : rest.slice(0, i)
  }
  const sums = new Map<string, FolderCount>()
  for (const [f, c] of s.counts) {
    // The root's own pictures are on no tile: childOf('') is null.
    const name = childOf(f)
    if (name === null) continue
    const sum = sums.get(name) ?? { images: 0, done: 0, failed: 0 }
    sum.images += c.images
    sum.done += c.done
    sum.failed += c.failed
    sums.set(name, sum)
  }
  const broken = new Set<string>()
  for (const u of s.unlisted) {
    const name = childOf(u)
    if (name !== null) {
      broken.add(name)
      if (!sums.has(name)) sums.set(name, { images: 0, done: 0, failed: 0 })
    }
  }
  const out = new Map<string, TileProgress>()
  for (const [name, sum] of sums) {
    const t = tile(sum, s.listed.has(prefix + name), broken.has(name))
    if (t) out.set(name, t)
  }
  return out
}

/** What a tile or header says of it, in words, for its title and reader. */
export function tileWords(t: TileProgress): string {
  return `${t.done.toLocaleString()} of ${t.images.toLocaleString()} indexed` +
    (t.failed ? `, ${t.failed.toLocaleString()} unreadable` : '') +
    (t.listing ? ', still listing' : '') +
    (t.broken ? ', a folder in it could not be listed' : '')
}
