import type { BrowserCopy } from './listingStore'
import type { StoredThumb, ThumbStore } from './thumbs'

// ---------------------------------------------------------------------------
// The folders QuickQueue has been given, remembered on this device.
//
// A File System Access directory handle can be stored in IndexedDB and read
// back after a reload; what does NOT survive is the permission, which the
// browser keeps on its own terms (master reference sec 22.12-22.13: Chrome on
// a PC with "Allow on every visit" brings it back with no click; Android
// Chrome needs one tap per folder after every restart). So the handle is kept
// here and its permission is asked afresh every time (queryPermission), never
// assumed.
//
// The handle names the folder, never the path: the browser does not reveal
// where on disk it is, and nothing here stores more than the folder's own
// name. Purge (client/browserPurge.ts) deletes this database today, as it
// does every database but the keys; tc.152 step 6 makes it a checklist entry.
// ---------------------------------------------------------------------------

// The parts of File System Access this uses that TypeScript's DOM library does
// not declare yet (the permission pair, the picker, async iteration), and the
// write half the folder index uses (scan.ts writes `.quickqueue/` with it).
export interface QqDirHandle {
  readonly kind: 'directory'
  readonly name: string
  isSameEntry(other: QqDirHandle): Promise<boolean>
  queryPermission(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  values(): AsyncIterable<QqDirHandle | QqFileHandle>
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<QqDirHandle>
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<QqFileHandle>
}

export interface QqFileHandle {
  readonly kind: 'file'
  readonly name: string
  getFile(): Promise<File>
  createWritable(opts?: { keepExistingData?: boolean }): Promise<QqWritable>
}

export interface QqWritable {
  seek(position: number): Promise<void>
  write(data: Uint8Array): Promise<void>
  truncate(size: number): Promise<void>
  close(): Promise<void>
  abort(): Promise<void>
}

type Picker = (opts: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<QqDirHandle>

export function folderAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window && typeof indexedDB !== 'undefined'
}

/** Opens the system folder picker. Must run inside a click (user activation).
 *  Read only: step 1 shows folders and writes nothing into them. */
export async function pickFolder(): Promise<QqDirHandle> {
  const picker = (window as unknown as { showDirectoryPicker: Picker }).showDirectoryPicker
  return picker({ id: 'quickqueue', mode: 'read' })
}

export interface StoredRoot {
  id: number
  name: string
  handle: QqDirHandle
}

const DB_NAME = 'technetium-quickqueue'
const STORE = 'roots'
/** A folder's index kept in this browser, for a folder QuickQueue may not
 *  write (QQ_FOLDER_INDEX.md sec 4). Keyed by the root's id. */
const KEPT = 'kept'
/** Each folder's saved listing in this browser (listingStore.ts), keyed by
 *  the root's id. */
const LISTINGS = 'listings'
/** Thumbnails made from the folders' pictures (thumbs.ts), keyed by
 *  `<root id>/<folder path>/<file name>`, indexed by when each was last used. */
const THUMBS = 'thumbs'
const THUMBS_USED = 'at'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // v2 adds the kept store, v3 the listings, v4 the thumbnails. Every connection here closes
    // after its one transaction, so an upgrade is never blocked by another tab
    // for long.
    const req = indexedDB.open(DB_NAME, 4)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
      if (!db.objectStoreNames.contains(KEPT)) db.createObjectStore(KEPT, { keyPath: 'rootId' })
      if (!db.objectStoreNames.contains(LISTINGS)) db.createObjectStore(LISTINGS, { keyPath: 'rootId' })
      if (!db.objectStoreNames.contains(THUMBS)) {
        db.createObjectStore(THUMBS, { keyPath: 'key' }).createIndex(THUMBS_USED, 'at')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB refused to open'))
  })
}

/** One transaction over `stores`; resolves when it commits. `fn` may chain
 *  requests inside it. */
async function withTx<T>(stores: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => () => T): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode)
      const result = fn(tx)
      tx.oncomplete = () => resolve(result())
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    })
  } finally {
    db.close()
  }
}

function withStore<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return withTx([store], mode, (tx) => {
    const req = fn(tx.objectStore(store))
    return () => req.result
  })
}

export async function listRoots(): Promise<StoredRoot[]> {
  const rows = await withStore<StoredRoot[]>(STORE, 'readonly', (s) => s.getAll() as IDBRequest<StoredRoot[]>)
  return rows.sort((a, b) => a.id - b.id)
}

/** Remembers a picked folder. Picking one already remembered returns that one
 *  rather than a second copy of it. */
export async function addRoot(handle: QqDirHandle): Promise<StoredRoot> {
  for (const r of await listRoots()) {
    try {
      if (await r.handle.isSameEntry(handle)) return r
    } catch {
      // A handle that can no longer be compared is not this one.
    }
  }
  const id = await withStore<IDBValidKey>(STORE, 'readwrite', (s) => s.add({ name: handle.name, handle }))
  return { id: Number(id), name: handle.name, handle }
}

/** Every thumbnail key of one root: `<id>/` and anything after it. */
function rootThumbs(id: number): IDBKeyRange {
  return IDBKeyRange.bound(`${id}/`, `${id}/\uffff`)
}

/** Forgets a folder, and the index, listing and thumbnails this browser kept for it. */
export async function forgetRoot(id: number): Promise<void> {
  await withTx([STORE, KEPT, LISTINGS, THUMBS], 'readwrite', (tx) => {
    tx.objectStore(STORE).delete(id)
    tx.objectStore(KEPT).delete(id)
    tx.objectStore(LISTINGS).delete(id)
    tx.objectStore(THUMBS).delete(rootThumbs(id))
    return () => undefined
  })
}

// --- The index kept in this browser -------------------------------------------

/**
 * Where a folder's index is kept when QuickQueue may not write `.quickqueue/`
 * into it: the same segment bytes, in this browser (scan.ts). Other devices
 * cannot see it, so they scan the folder again; the panel says so.
 */
export interface Keeper {
  /** The kept segment, or null when nothing is kept. */
  read(): Promise<Uint8Array | null>
  /** Replaces everything from `offset` on with `bytes`, all or nothing. */
  writeAt(offset: number, bytes: Uint8Array): Promise<void>
  /** Removes it, once its records are in the folder. */
  drop(): Promise<void>
}

interface KeptRow { rootId: number; bytes: Uint8Array }

export function browserKeeper(rootId: number): Keeper {
  return {
    read: () => withStore<KeptRow | undefined>(KEPT, 'readonly', (s) => s.get(rootId) as IDBRequest<KeptRow | undefined>)
      .then((row) => (row ? row.bytes : null)),
    // Read and write in ONE transaction, so a failure leaves the row as it was
    // and two writers can never interleave.
    writeAt: (offset, bytes) => withTx([KEPT], 'readwrite', (tx) => {
      const s = tx.objectStore(KEPT)
      const get = s.get(rootId) as IDBRequest<KeptRow | undefined>
      get.onsuccess = () => {
        const old = get.result?.bytes ?? new Uint8Array(0)
        if (offset > old.length) { tx.abort(); return }
        const next = new Uint8Array(offset + bytes.length)
        next.set(old.subarray(0, offset))
        next.set(bytes, offset)
        s.put({ rootId, bytes: next } satisfies KeptRow)
      }
      return () => undefined
    }),
    drop: () => withStore<undefined>(KEPT, 'readwrite', (s) => s.delete(rootId) as IDBRequest<undefined>),
  }
}

// --- The listing kept in this browser ------------------------------------------

interface ListingRow { rootId: number; bytes: Uint8Array }

/** This browser's copy of a folder's saved listing (listingStore.ts). */
export function browserListing(rootId: number): BrowserCopy {
  return {
    read: () => withStore<ListingRow | undefined>(LISTINGS, 'readonly', (s) => s.get(rootId) as IDBRequest<ListingRow | undefined>)
      .then((row) => (row ? row.bytes : null)),
    write: (bytes) => withStore<IDBValidKey>(LISTINGS, 'readwrite', (s) => s.put({ rootId, bytes } satisfies ListingRow)).then(() => undefined),
  }
}

// --- The last folder open, per browser ---------------------------------------

const LAST_ROOT_KEY = 'net.41chan.qq_last_root'

export function storedLastRoot(): number | null {
  try {
    const v = localStorage.getItem(LAST_ROOT_KEY)
    const n = v === null ? NaN : Number(v)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export function storeLastRoot(id: number): void {
  try { localStorage.setItem(LAST_ROOT_KEY, String(id)) } catch { /* a convenience, not a record */ }
}

// --- Thumbnails kept in this browser -------------------------------------------

/** Where thumbs.ts keeps thumbnails: this browser only (operator 2026-11-23). */
export function browserThumbs(): ThumbStore {
  return {
    getMany: (keys) => withTx([THUMBS], 'readonly', (tx) => {
      const s = tx.objectStore(THUMBS)
      const out = new Map<string, StoredThumb>()
      for (const k of keys) {
        const req = s.get(k) as IDBRequest<StoredThumb | undefined>
        req.onsuccess = () => { if (req.result) out.set(k, req.result) }
      }
      return () => out
    }),
    putMany: (rows) => withTx([THUMBS], 'readwrite', (tx) => {
      const s = tx.objectStore(THUMBS)
      for (const r of rows) s.put(r)
      return () => undefined
    }),
    remove: (key) => withStore<undefined>(THUMBS, 'readwrite', (s) => s.delete(key) as IDBRequest<undefined>),
    // Summed and trimmed in one transaction, least recently used first. The
    // index hands the rows back oldest first; a Blob read from IndexedDB is a
    // handle, so its size costs no read of its bytes.
    trim: (maxBytes) => withTx([THUMBS], 'readwrite', (tx) => {
      const s = tx.objectStore(THUMBS)
      const all = s.index(THUMBS_USED).getAll() as IDBRequest<StoredThumb[]>
      all.onsuccess = () => {
        let over = all.result.reduce((sum, r) => sum + r.blob.size, 0) - maxBytes
        for (const r of all.result) {
          if (over <= 0) break
          s.delete(r.key)
          over -= r.blob.size
        }
      }
      return () => undefined
    }),
  }
}
