import { useEffect, useMemo, useRef, useState } from 'react'
import { useLightbox, type LightboxItem } from '../ui/lightboxContext'
import {
  addRoot, folderAccessSupported, forgetRoot, listRoots, pickFolder, storeLastRoot, storedLastRoot,
  type QqDirHandle, type QqFileHandle, type StoredRoot,
} from './folderStore'
import {
  arrangeListing, folderView, gridWindow, imageType,
  type Arranged, type ListedEntry, type Permission,
} from './qqGrid'
import { thumbFor, cachedThumb } from './thumbs'

// ---------------------------------------------------------------------------
// QuickQueue's panel (tc.152 step 1): the folders this device has been given,
// and a grid of what is in one of them. Loaded only when the panel is first
// opened (QuickQueueDrawer.tsx), so a user who never opens it never downloads
// it.
//
// Step 1 READS ONLY. It asks for read access, lists, makes thumbnails and
// opens pictures full screen in the room Lightbox. Nothing is written into the
// folder, nothing leaves the device, nothing is posted. Scan, search and
// queues are steps 2-5.
// ---------------------------------------------------------------------------

type Handle = QqDirHandle | QqFileHandle

const MIN_TILE = 112
const GAP = 6
const OVERSCAN_ROWS = 3

function counted(n: number, noun: string): string {
  return `${n.toLocaleString()} ${noun}${n === 1 ? '' : 's'}`
}

function errorName(e: unknown): string {
  return e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : ''
}

export default function QuickQueuePanel() {
  const lightbox = useLightbox()
  const [supported] = useState(folderAccessSupported)
  const [roots, setRoots] = useState<StoredRoot[] | null>(null)
  const [rootId, setRootId] = useState<number | null>(null)
  const [permission, setPermission] = useState<Permission | null>(null)
  // The subfolders opened below the root, outermost first.
  const [trail, setTrail] = useState<QqDirHandle[]>([])
  const [listing, setListing] = useState<{ key: string; arranged: Arranged<Handle> } | null>(null)
  const [listedSoFar, setListedSoFar] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)

  const root = roots?.find((r) => r.id === rootId) ?? null
  const dir: QqDirHandle | null = trail.length > 0 ? trail[trail.length - 1] : (root?.handle ?? null)
  const dirKey = root ? `${root.id}/${trail.map((d) => d.name).join('/')}` : ''
  const view = folderView(supported, roots !== null, !!root, permission)

  // The folders remembered on this device, and which was open last.
  useEffect(() => {
    if (!supported) return
    let cancelled = false
    listRoots()
      .then((rs) => {
        if (cancelled) return
        setRoots(rs)
        const last = storedLastRoot()
        setRootId(rs.find((r) => r.id === last)?.id ?? rs[0]?.id ?? null)
      })
      .catch(() => {
        if (cancelled) return
        setRoots([])
        setProblem('This browser would not open its storage for QuickQueue, so no folder is remembered. Private windows do this; a normal window keeps folders.')
      })
    return () => { cancelled = true }
  }, [supported])

  // Whether this browser session may read the folder. Asked, never assumed:
  // a remembered folder is not a granted one (sec 22.13).
  useEffect(() => {
    if (!root) return
    let cancelled = false
    root.handle.queryPermission({ mode: 'read' })
      .then((p) => { if (!cancelled) setPermission(p) })
      .catch(() => { if (!cancelled) setPermission('prompt') })
    return () => { cancelled = true }
  }, [root])

  // List the open folder to the end, then show it whole (qqGrid.ts says why).
  useEffect(() => {
    if (!dir || permission !== 'granted') return
    let cancelled = false
    const entries: ListedEntry<Handle>[] = []
    let lastTick = 0
    queueMicrotask(() => {
      if (cancelled) return
      setListedSoFar(0)
      setProblem(null)
    })
    void (async () => {
      try {
        for await (const h of dir.values()) {
          if (cancelled) return
          entries.push({ name: h.name, kind: h.kind, handle: h })
          const now = performance.now()
          if (now - lastTick > 250) {
            lastTick = now
            setListedSoFar(entries.length)
          }
        }
        if (cancelled) return
        setListing({ key: dirKey, arranged: arrangeListing(entries) })
      } catch (e) {
        if (cancelled) return
        const name = errorName(e)
        if (name === 'NotAllowedError') {
          setPermission('prompt')
        } else {
          setProblem(
            name === 'NotFoundError'
              ? `"${dir.name}" is not where it was: it may have been moved, renamed or deleted. Pick it again, or forget it.`
              : `"${dir.name}" could not be listed (${name || 'unknown error'}). Pick it again; if that fails too, the folder is not readable from this browser.`,
          )
        }
      }
    })()
    return () => { cancelled = true }
  }, [dir, dirKey, permission])

  const shown = listing && listing.key === dirKey ? listing.arranged : null

  const choose = (id: number) => {
    storeLastRoot(id)
    setRootId(id)
    setPermission(null)
    setTrail([])
    setProblem(null)
  }

  const pick = async () => {
    try {
      const handle = await pickFolder()
      const added = await addRoot(handle)
      setRoots(await listRoots())
      storeLastRoot(added.id)
      setRootId(added.id)
      setTrail([])
      setProblem(null)
      // The picker's own grant; the effect above asks again anyway.
      setPermission('granted')
    } catch (e) {
      // Closing the picker is a choice, not a failure.
      if (errorName(e) === 'AbortError') return
      setProblem(`The folder could not be opened (${errorName(e) || 'unknown error'}). Try picking it again.`)
    }
  }

  const reopen = async () => {
    if (!root) return
    try {
      setPermission(await root.handle.requestPermission({ mode: 'read' }))
    } catch (e) {
      setProblem(`"${root.name}" could not be reopened (${errorName(e) || 'unknown error'}). Pick it again.`)
    }
  }

  const forget = async (id: number) => {
    await forgetRoot(id)
    const rs = await listRoots()
    setRoots(rs)
    if (id === rootId) choose(rs[0]?.id ?? -1)
  }

  const openPicture = (index: number) => {
    if (!shown) return
    const items: LightboxItem[] = shown.images.map((e) => ({
      mxc: '',
      name: e.name,
      mimetype: imageType(e.name) ?? undefined,
      local: () => (e.handle as QqFileHandle).getFile(),
    }))
    lightbox.open(items, index)
  }

  return (
    <div className="tc-qq" data-view={view}>
      <div className="tc-qq-head">
        <div className="tc-qq-roots" role="tablist" aria-label="Folders">
          {roots?.map((r) => (
            <span key={r.id} className="tc-qq-root" data-active={r.id === rootId ? 'true' : 'false'}>
              <button type="button" role="tab" aria-selected={r.id === rootId} onClick={() => choose(r.id)}>
                {r.name}
              </button>
              <button
                type="button"
                className="tc-qq-forget"
                aria-label={`Forget ${r.name}`}
                title={`Forget ${r.name} on this device (the folder itself is not touched)`}
                onClick={() => void forget(r.id)}
              >
                x
              </button>
            </span>
          ))}
        </div>
        {supported && (
          <button type="button" className="tc-pill" onClick={() => void pick()}>
            Add folder
          </button>
        )}
      </div>

      {view === 'ready' && root && (
        <div className="tc-qq-crumbs" aria-label="Where you are">
          <button type="button" onClick={() => setTrail([])} disabled={trail.length === 0}>{root.name}</button>
          {trail.map((d, i) => (
            <span key={i}>
              <span aria-hidden="true" className="tc-qq-sep">/</span>
              <button type="button" onClick={() => setTrail(trail.slice(0, i + 1))} disabled={i === trail.length - 1}>
                {d.name}
              </button>
            </span>
          ))}
          <span className="tc-qq-count">
            {shown
              ? // Pictures are always counted (an empty folder says "0 pictures");
                // folders and other files only when there are some.
                counted(shown.images.length, 'picture') +
                (shown.dirs.length ? `, ${counted(shown.dirs.length, 'folder')}` : '') +
                (shown.otherFiles ? `, ${counted(shown.otherFiles, 'other file')} not shown` : '')
              : ''}
          </span>
        </div>
      )}

      {problem && <p className="tc-qq-note tc-tone-warn">{problem}</p>}

      <div className="tc-qq-body">
        {view === 'unsupported' && (
          <p className="tc-qq-note">
            This browser cannot open folders on this device, so QuickQueue has nothing to show. It needs Chrome or
            Edge on a computer, or Chrome 132 or later on Android. Firefox and Safari do not offer it; Brave offers it
            only once switched on at brave://flags/#file-system-access-api.
          </p>
        )}
        {view === 'loading' && <p className="tc-qq-note">Looking for the folders this device remembers...</p>}
        {view === 'pick' && (
          <div className="tc-qq-ask">
            <p className="tc-qq-note">
              Pick a folder of pictures to browse it here. Nothing is uploaded: the pictures stay on this device until
              you post one.
            </p>
            <button type="button" className="tc-pill" onClick={() => void pick()}>Pick a folder</button>
          </div>
        )}
        {view === 'reopen' && root && (
          <div className="tc-qq-ask">
            <p className="tc-qq-note">This browser asks again before reading "{root.name}" after a restart.</p>
            <button type="button" className="tc-pill" onClick={() => void reopen()}>Reopen {root.name}</button>
          </div>
        )}
        {view === 'denied' && root && (
          <div className="tc-qq-ask">
            <p className="tc-qq-note">
              Reading "{root.name}" was refused. Pick it again to allow it, or forget it.
            </p>
            <button type="button" className="tc-pill" onClick={() => void pick()}>Pick a folder</button>
          </div>
        )}
        {view === 'ready' && !shown && !problem && (
          <p className="tc-qq-note">Listing "{dir?.name}": {listedSoFar.toLocaleString()} so far.</p>
        )}
        {view === 'ready' && shown && (
          <FolderGrid
            key={dirKey}
            arranged={shown}
            thumbKey={(name) => `${dirKey}/${name}`}
            onOpenDir={(d) => setTrail([...trail, d])}
            onOpenPicture={openPicture}
          />
        )}
      </div>
    </div>
  )
}

function FolderGrid({
  arranged,
  thumbKey,
  onOpenDir,
  onOpenPicture,
}: {
  arranged: Arranged<Handle>
  thumbKey: (name: string) => string
  onOpenDir: (d: QqDirHandle) => void
  onOpenPicture: (imageIndex: number) => void
}) {
  const scroller = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ width: 0, height: 0, top: 0 })

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    let frame = 0
    const measure = () => {
      frame = 0
      // clientWidth includes the scroller's side padding; the tiles get what
      // is inside it, or the last column runs off the right edge.
      const cs = getComputedStyle(el)
      const inner = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)
      setBox({ width: Math.max(0, inner), height: el.clientHeight, top: el.scrollTop })
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }
    schedule()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    ro?.observe(el)
    el.addEventListener('scroll', schedule, { passive: true })
    return () => {
      ro?.disconnect()
      el.removeEventListener('scroll', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  const dirCount = arranged.dirs.length
  const count = dirCount + arranged.images.length
  const win = useMemo(
    () => gridWindow({ count, width: box.width, height: box.height, scrollTop: box.top, minTile: MIN_TILE, gap: GAP, overscanRows: OVERSCAN_ROWS }),
    [count, box],
  )

  if (count === 0) {
    return (
      <div className="tc-qq-grid" ref={scroller}>
        <p className="tc-qq-note">No pictures or folders here.</p>
      </div>
    )
  }

  const tiles = []
  for (let i = win.first; i < win.last; i++) {
    const row = Math.floor(i / win.cols)
    const col = i % win.cols
    const style = {
      top: row * win.rowStep,
      left: col * (win.tile + GAP),
      width: win.tile,
      height: win.tile,
    }
    if (i < dirCount) {
      const d = arranged.dirs[i]
      tiles.push(
        <button key={`d:${d.name}`} type="button" className="tc-qq-cell" data-kind="dir" style={style} title={d.name}
          onClick={() => onOpenDir(d.handle as QqDirHandle)}>
          <span className="tc-qq-folder" aria-hidden="true" />
          <span className="tc-qq-name">{d.name}</span>
        </button>,
      )
    } else {
      const e = arranged.images[i - dirCount]
      const imageIndex = i - dirCount
      tiles.push(
        <ImageTile key={`f:${e.name}`} name={e.name} handle={e.handle as QqFileHandle} cacheKey={thumbKey(e.name)}
          style={style} onOpen={() => onOpenPicture(imageIndex)} />,
      )
    }
  }

  return (
    <div className="tc-qq-grid" ref={scroller}>
      <div className="tc-qq-canvas" style={{ height: win.totalHeight }}>{tiles}</div>
    </div>
  )
}

function ImageTile({
  name,
  handle,
  cacheKey,
  style,
  onOpen,
}: {
  name: string
  handle: QqFileHandle
  cacheKey: string
  style: React.CSSProperties
  onOpen: () => void
}) {
  // A cached thumbnail is there on the first frame; only a new one waits.
  const [src, setSrc] = useState<string | null>(() => cachedThumb(cacheKey))
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (src) return
    let alive = true
    thumbFor(cacheKey, handle, () => alive)
      .then((url) => { if (alive) setSrc(url) })
      .catch((e) => { if (alive && (e as Error)?.message !== 'skipped') setFailed(true) })
    return () => { alive = false }
  }, [cacheKey, handle, src])

  return (
    <button type="button" className="tc-qq-cell" data-kind="image" style={style} title={name} onClick={onOpen}>
      {src ? (
        <img src={src} alt={name} draggable={false} />
      ) : (
        <span className="tc-qq-name">{failed ? `${name} (cannot be shown)` : name}</span>
      )}
    </button>
  )
}
