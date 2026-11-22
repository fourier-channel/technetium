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
import { FolderScan, INDEX_DIR, storedDeviceId, type ScanPhase, type ScanProgress } from './scan'
import { calendarTotals, scanCalendar, type CalendarRow } from './scanCalendar'

// ---------------------------------------------------------------------------
// QuickQueue's panel (tc.152 step 1): the folders this device has been given,
// and a grid of what is in one of them. Loaded only when the panel is first
// opened (QuickQueueDrawer.tsx), so a user who never opens it never downloads
// it.
//
// Browsing reads only: it asks for read access, lists, makes thumbnails and
// opens pictures full screen in the room Lightbox. The Scan (step 2,
// QQ_FOLDER_INDEX.md sec 7a) is the one thing that writes, and only inside
// the folder's .quickqueue/, after the user has seen its cost and said go.
// Nothing leaves the device and nothing is posted. Search and queues are
// steps 3-5.
// ---------------------------------------------------------------------------

type Handle = QqDirHandle | QqFileHandle

const MIN_TILE = 112
const GAP = 6
const OVERSCAN_ROWS = 3

function counted(n: number, noun: string, plural = `${noun}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? noun : plural}`
}

function errorName(e: unknown): string {
  return e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : ''
}

function duration(seconds: number): string {
  if (seconds < 90) return counted(Math.max(1, Math.round(seconds)), 'second')
  const m = Math.round(seconds / 60)
  if (m < 90) return counted(m, 'minute')
  return `${counted(Math.floor(m / 60), 'hour')} ${counted(m % 60, 'minute')}`
}

function size(bytes: number): string {
  if (bytes < 1000) return counted(bytes, 'byte')
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(1)} KB`
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${(bytes / 1e9).toFixed(2)} GB`
}

const FINISHED: ReadonlySet<ScanPhase> = new Set(['done', 'stopped', 'failed'])

/** One Scan and what the panel shows of it. */
interface ScanRun {
  rootId: number
  rootName: string
  handle: QqDirHandle
  engine: FolderScan
  progress: ScanProgress
  rows: CalendarRow[]
  /** Said before the user says go: write access refused, device id not kept. */
  notes: string[]
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
  const [scanRun, setScanRun] = useState<ScanRun | null>(null)
  const [showScan, setShowScan] = useState(true)
  const engineRef = useRef<FolderScan | null>(null)
  const scanActive = !!scanRun && !FINISHED.has(scanRun.progress.phase)

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

  // A panel taken down mid-scan stops it; what was read after Start is saved.
  useEffect(() => {
    const ref = engineRef
    return () => ref.current?.stop()
  }, [])

  const shown = listing && listing.key === dirKey ? listing.arranged : null

  const startScan = async () => {
    if (!root || scanActive) return
    // Asked at the press, the gesture the browser needs. Refused, the scan
    // still runs and keeps its index in this tab (sec 7a step 7); the note
    // below says so before the user says go.
    let write = 'denied'
    let asked = ''
    try {
      write = await root.handle.requestPermission({ mode: 'readwrite' })
    } catch (e) {
      asked = errorName(e) || 'unknown error'
    }
    const device = storedDeviceId()
    const notes: string[] = []
    if (write !== 'granted') {
      notes.push(
        `${asked ? `Asking to edit "${root.name}" failed (${asked})` : `Editing "${root.name}" was not allowed`}, so this scan ` +
        `keeps its index in this tab only: nothing is saved into the folder, and the next scan reads it all again. ` +
        `To save it, Stop, press Scan again and allow editing; QuickQueue writes only inside ${INDEX_DIR}.`,
      )
    }
    if (!device.kept) {
      notes.push(
        'This browser would not keep QuickQueue\'s device id, so this scan saves into an index file of its own. ' +
        'That costs space, never correctness; a normal (not private) window keeps the id.',
      )
    }
    const target = { id: root.id, name: root.name, handle: root.handle }
    let rowsAt = 0
    const engine: FolderScan = new FolderScan({
      root: target.handle,
      deviceId: device.id,
      onProgress: (p) => {
        // The engine reports at most every 200 ms; the calendar is rebuilt at
        // most once a second while reading, and on every change of phase.
        const now = performance.now()
        const rebuild = p.phase !== 'reading' || now - rowsAt > 1000
        if (rebuild) rowsAt = now
        setScanRun((r) => (r && r.engine === engine
          ? { ...r, progress: p, rows: rebuild ? scanCalendar(engine.folderProgress(), target.name) : r.rows }
          : r))
      },
    })
    engineRef.current?.stop()
    engineRef.current = engine
    setShowScan(true)
    setScanRun({ rootId: target.id, rootName: target.name, handle: target.handle, engine, progress: engine.progress(), rows: [], notes })
    void engine.prepare()
  }

  const goScan = async () => {
    if (!scanRun) return
    if (scanRun.progress.phase === 'paused') {
      // A lapsed grant is the usual pause; asking again is what lets it go
      // on. Refused, run() pauses again at once and says why.
      try { await scanRun.handle.requestPermission({ mode: 'readwrite' }) } catch { /* run() reports it */ }
    }
    void scanRun.engine.run()
  }

  const closeScan = () => {
    engineRef.current = null
    setScanRun(null)
  }

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
    // A forgotten folder is not scanned on behind the user's back.
    if (scanRun?.rootId === id) {
      scanRun.engine.stop()
      closeScan()
    }
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
        {view === 'ready' && root && (
          <button
            type="button"
            className="tc-pill"
            disabled={scanActive}
            title={scanActive
              ? 'A scan is running; one runs at a time'
              : `Read the prompt of every picture in "${root.name}" into an index kept inside it (${INDEX_DIR})`}
            onClick={() => void startScan()}
          >
            Scan
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

      {scanRun && (
        <ScanStrip
          run={scanRun}
          viewing={scanRun.rootId === rootId}
          showing={showScan}
          onToggle={() => setShowScan(!showScan)}
          onGo={() => void goScan()}
          onPause={() => scanRun.engine.pause()}
          onStop={() => scanRun.engine.stop()}
          onClose={closeScan}
        />
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
        {view === 'ready' && scanRun && scanRun.rootId === rootId && showScan ? (
          <ScanCalendar rows={scanRun.rows} rootName={scanRun.rootName} />
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  )
}

function scanWords(run: ScanRun): string {
  const p = run.progress
  const left = Math.max(0, p.toRead - p.read)
  const eta = p.etaSeconds === null ? null : duration(p.etaSeconds)
  switch (p.phase) {
    case 'idle':
      return `Starting a scan of "${run.rootName}"...`
    case 'listing':
      return `Listing "${run.rootName}": ${counted(p.listed, 'file')} in ${counted(p.folders, 'folder')} so far.`
    case 'indexing':
      return `Reading the index already kept in ${INDEX_DIR}...`
    case 'calibrating':
      return 'Timing a few reads on this device...'
    case 'planned':
      if (!left) return `Everything is read. Start saves ${counted(p.unsaved, 'entry', 'entries')} into ${INDEX_DIR}.`
      return `${counted(left, 'picture')} to read in "${run.rootName}", ` +
        (eta ? `about ${eta} on this device` : 'for a time that could not be measured (the first reads failed)') +
        `. The index grows by about ${size(p.addBytes)}${p.indexBytes ? `; it is ${size(p.indexBytes)} now` : ''}. ` +
        'Nothing is written until you press Start.'
    case 'reading':
      return `Reading "${run.rootName}", newest first${eta ? `: about ${eta} left` : ''}.`
    case 'pausing':
      return 'Pausing once the reads in flight finish...'
    case 'paused':
      if (!left && p.unsaved) {
        return `Read to the end, but ${counted(p.unsaved, 'entry', 'entries')} could not be saved into the folder; the problems say why. Resume tries again.`
      }
      return `Paused with ${counted(left, 'picture')} to read. Resume carries on from there.`
    case 'done':
      return `Scan of "${run.rootName}" finished: ${counted(p.read, 'picture')} read, ${counted(p.adopted, 'picture')} already indexed.`
    case 'stopped':
      return p.saved
        ? `Scan stopped. ${counted(p.saved, 'entry', 'entries')} saved; the next scan carries on from them.`
        : 'Scan stopped before anything was saved; nothing was written.'
    case 'failed':
      return 'The scan could not go on; the problems say why.'
  }
}

function ScanStrip({
  run, viewing, showing, onToggle, onGo, onPause, onStop, onClose,
}: {
  run: ScanRun
  viewing: boolean
  showing: boolean
  onToggle: () => void
  onGo: () => void
  onPause: () => void
  onStop: () => void
  onClose: () => void
}) {
  const p = run.progress
  const planned = !['idle', 'listing', 'indexing', 'calibrating'].includes(p.phase)
  const left = Math.max(0, p.toRead - p.read)
  const num = (n: number) => (planned ? n.toLocaleString() : '-')
  return (
    <section className="tc-qq-scan" aria-label={`Scan of ${run.rootName}`} aria-live="polite">
      <p className="tc-qq-scan-words">{scanWords(run)}</p>
      {run.notes.map((n) => <p key={n} className="tc-qq-note tc-tone-warn">{n}</p>)}
      {/* The four totals sec 7a step 8 names; second reads are the gauge for
          the prefix budget (PREFIX_BYTES), so a wrong budget shows here. */}
      <p className="tc-qq-scan-totals">
        <span>Read <b>{num(p.read)}</b></span>
        <span>To read <b>{num(left)}</b></span>
        <span>Unreadable <b>{num(p.unreadable)}</b></span>
        <span>Second reads <b>{num(p.secondReads)}</b></span>
      </p>
      <div className="tc-qq-scan-actions">
        {p.phase === 'planned' && <button type="button" className="tc-pill" onClick={onGo}>Start</button>}
        {p.phase === 'paused' && <button type="button" className="tc-pill" onClick={onGo}>Resume</button>}
        {(p.phase === 'reading' || p.phase === 'pausing') && (
          <button type="button" className="tc-pill" onClick={onPause} disabled={p.phase === 'pausing'}>Pause</button>
        )}
        {!FINISHED.has(p.phase) && (
          <button type="button" className="tc-pill" onClick={onStop}>{p.phase === 'planned' ? 'Cancel' : 'Stop'}</button>
        )}
        {FINISHED.has(p.phase) && <button type="button" className="tc-pill" onClick={onClose}>Close</button>}
        {p.problems.length > 0 && (
          <details className="tc-qq-problems">
            <summary>{counted(p.problems.length, 'problem')}</summary>
            <ul>{p.problems.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </details>
        )}
        {viewing && (
          <button type="button" className="tc-pill tc-qq-scan-toggle" onClick={onToggle}>
            {showing ? 'Show pictures' : 'Show scan'}
          </button>
        )}
      </div>
    </section>
  )
}

function ScanCalendar({ rows, rootName }: { rows: CalendarRow[]; rootName: string }) {
  const t = calendarTotals(rows)
  return (
    <div className="tc-qq-cal">
      <p className="tc-qq-cal-legend">
        <span><i className="tc-qq-cal-cell" data-state="done" aria-hidden="true" /> {t.done.toLocaleString()} done</span>
        <span><i className="tc-qq-cal-cell" data-state="reading" aria-hidden="true" style={{ '--tc-fill': '50%' } as React.CSSProperties} /> {t.reading.toLocaleString()} reading</span>
        <span><i className="tc-qq-cal-cell" data-state="listed" aria-hidden="true" /> {t.listed.toLocaleString()} listed</span>
        <span><i className="tc-qq-cal-cell" data-state="short" aria-hidden="true" /> {t.short.toLocaleString()} with unreadable files</span>
      </p>
      <div className="tc-qq-cal-scroll" role="list" aria-label="Folders by scan state">
        {rows.length === 0 && <p className="tc-qq-note">A cell for each folder appears once the folder is listed.</p>}
        {rows.map((r) => (
          <div key={r.parent} className="tc-qq-cal-row" role="listitem">
            <span className="tc-qq-cal-label" title={r.label}>{r.label}</span>
            <span className="tc-qq-cal-cells">
              {r.cells.map((c) => {
                const what = `${c.folder || rootName}: ${c.done.toLocaleString()} of ${c.images.toLocaleString()} indexed` +
                  (c.failed ? `, ${c.failed.toLocaleString()} unreadable` : '')
                return (
                  <i
                    key={c.folder}
                    className="tc-qq-cal-cell"
                    data-state={c.state}
                    role="img"
                    aria-label={what}
                    title={what}
                    style={{ '--tc-fill': `${Math.floor((100 * c.done) / c.images)}%` } as React.CSSProperties}
                  />
                )
              })}
            </span>
          </div>
        ))}
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
