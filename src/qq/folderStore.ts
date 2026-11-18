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
// not declare yet (the permission pair, the picker, async iteration).
export interface QqDirHandle {
  readonly kind: 'directory'
  readonly name: string
  isSameEntry(other: QqDirHandle): Promise<boolean>
  queryPermission(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  values(): AsyncIterable<QqDirHandle | QqFileHandle>
}

export interface QqFileHandle {
  readonly kind: 'file'
  readonly name: string
  getFile(): Promise<File>
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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB refused to open'))
  })
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req.result)
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    })
  } finally {
    db.close()
  }
}

export async function listRoots(): Promise<StoredRoot[]> {
  const rows = await withStore<StoredRoot[]>('readonly', (s) => s.getAll() as IDBRequest<StoredRoot[]>)
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
  const id = await withStore<IDBValidKey>('readwrite', (s) => s.add({ name: handle.name, handle }))
  return { id: Number(id), name: handle.name, handle }
}

export async function forgetRoot(id: number): Promise<void> {
  await withStore<undefined>('readwrite', (s) => s.delete(id) as IDBRequest<undefined>)
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
