import { useEffect, useMemo, useRef, useState } from 'react'
import { useLightbox, type LightboxItem } from '../ui/lightboxContext'
import {
  addRoot, browserKeeper, folderAccessSupported, forgetRoot, listRoots, pickFolder, storeLastRoot, storedLastRoot,
  type QqDirHandle, type QqFileHandle, type StoredRoot,
} from './folderStore'
import {
  arrangeListing, folderView, gridWindow, imageType,
  type Arranged, type ListedEntry, type Permission,
} from './qqGrid'
import { thumbFor, cachedThumb } from './thumbs'
import { FolderScan, INDEX_DIR, STALL_MS, stalled, storedDeviceId, type ScanPhase, type ScanProgress } from './scan'
import { childTiles, subtreeOf, tileWords, type ScanFolders, type TileProgress } from './scanRollup'

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
/** One folder's listing and when it finished (Date.now()). */
interface Listing {
  arranged: Arranged<Handle>
  at: number
}

interface ScanRun {
  rootId: number
  rootName: string
  handle: QqDirHandle
  engine: FolderScan
  progress: ScanProgress
  /** What the folder tiles draw (scanRollup.ts), refreshed with the words. */
  folders: ScanFolders
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
  // Every folder listed this visit, by dirKey, and when. Going back to one
  // shows it at once: the browser gives a folder no modified date, so listing
  // it again is the only check, and a 25,000-name folder on the tablet takes
  // minutes (operator 2026-11-23: a wait over about 10 s per load is not an
  // acceptable cost). "List again" drops the folder's entry and lists it anew.
  const [listings, setListings] = useState<ReadonlyMap<string, Listing>>(new Map())
  const [listedSoFar, setListedSoFar] = useState(0)
  const [listSeconds, setListSeconds] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)
  const [scanRun, setScanRun] = useState<ScanRun | null>(null)
  const engineRef = useRef<FolderScan | null>(null)
  const scanActive = !!scanRun && !FINISHED.has(scanRun.progress.phase)
  // The stall watch: time since the engine last reported a step.
  const lastStepRef = useRef(0)
  const [idleMs, setIdleMs] = useState(0)
  const scanPhase = scanRun?.progress.phase
  useEffect(() => {
    if (!scanPhase || FINISHED.has(scanPhase)) return
    const t = setInterval(() => setIdleMs(performance.now() - lastStepRef.current), 5000)
    return () => clearInterval(t)
  }, [scanPhase])

  const root = roots?.find((r) => r.id === rootId) ?? null
  const dir: QqDirHandle | null = trail.length > 0 ? trail[trail.length - 1] : (root?.handle ?? null)
  const dirKey = root ? `${root.id}/${trail.map((d) => d.name).join('/')}` : ''
  const view = folderView(supported, roots !== null, !!root, permission)
  // A Scan of the folder being browsed is drawn on it: each folder tile
  // carries the state of everything below it, and the crumbs carry the
  // folder open now. A Scan of another folder draws on nothing here.
  const scanHere = scanRun && scanRun.rootId === rootId ? scanRun.folders : null
  const herePath = trail.map((d) => d.name).join('/')
  const tiles = useMemo(() => (scanHere ? childTiles(scanHere, herePath) : null), [scanHere, herePath])
  const hereTile = useMemo(
    () => (scanHere && herePath ? subtreeOf(scanHere, herePath) : undefined),
    [scanHere, herePath],
  )

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

  // List the open folder to the end, then show it whole (qqGrid.ts says why),
  // unless it was listed already this visit.
  const hasListing = listings.has(dirKey)
  useEffect(() => {
    if (!dir || permission !== 'granted' || hasListing) return
    let cancelled = false
    const entries: ListedEntry<Handle>[] = []
    let lastTick = 0
    const started = performance.now()
    queueMicrotask(() => {
      if (cancelled) return
      setListedSoFar(0)
      setListSeconds(0)
      setProblem(null)
    })
    // The clock runs even when no name arrives, so a stall shows as one.
    const clock = setInterval(() => setListSeconds(Math.floor((performance.now() - started) / 1000)), 1000)
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
        const done: Listing = { arranged: arrangeListing(entries), at: Date.now() }
        setListings((m) => new Map(m).set(dirKey, done))
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
      } finally {
        clearInterval(clock)
      }
    })()
    return () => {
      cancelled = true
      clearInterval(clock)
    }
  }, [dir, dirKey, permission, hasListing])

  // A panel taken down mid-scan stops it; what was read after Start is saved.
  useEffect(() => {
    const ref = engineRef
    return () => ref.current?.stop()
  }, [])

  const here = listings.get(dirKey) ?? null
  const shown = here?.arranged ?? null
  const listAgain = () => {
    setListings((m) => {
      const n = new Map(m)
      n.delete(dirKey)
      return n
    })
  }

  const startScan = async () => {
    if (!root || scanActive) return
    // Asked at the press, the gesture the browser needs. Refused, the scan
    // still runs and keeps its index in this browser (sec 4, sec 7a step 7);
    // the note below says so before the user says go.
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
        `keeps its index in this browser, not in the folder, so other devices will scan it again. ` +
        `To save it into the folder, Stop, press Scan again and allow editing; QuickQueue writes only inside ${INDEX_DIR}, ` +
        `and moves what this browser kept into it.`,
      )
    }
    if (!device.kept) {
      notes.push(
        'This browser would not keep QuickQueue\'s device id, so this scan saves into an index file of its own. ' +
        'That costs space, never correctness; a normal (not private) window keeps the id.',
      )
    }
    const target = { id: root.id, name: root.name, handle: root.handle }
    let foldersAt = 0
    const engine: FolderScan = new FolderScan({
      root: target.handle,
      deviceId: device.id,
      keeper: browserKeeper(target.id),
      saveTo: write === 'granted' ? 'folder' : 'browser',
      onProgress: (p) => {
        lastStepRef.current = performance.now()
        setIdleMs(0)
        // The engine reports at most every 200 ms; the tiles' snapshot is
        // taken at most once a second while listing or reading, and on every
        // other change of phase.
        const now = performance.now()
        const busy = p.phase === 'reading' || p.phase === 'listing'
        const rebuild = !busy || now - foldersAt > 1000
        if (rebuild) foldersAt = now
        setScanRun((r) => (r && r.engine === engine
          ? { ...r, progress: p, folders: rebuild ? engine.folders() : r.folders }
          : r))
      },
    })
    engineRef.current?.stop()
    engineRef.current = engine
    lastStepRef.current = performance.now()
    setIdleMs(0)
    setScanRun({
      rootId: target.id, rootName: target.name, handle: target.handle, engine, progress: engine.progress(), folders: engine.folders(), notes,
    })
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
    setListings((m) => new Map([...m].filter(([k]) => !k.startsWith(`${id}/`))))
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
                (shown.otherFiles ? `, ${counted(shown.otherFiles, 'other file')} not shown` : '') +
                (hereTile ? `; scan: ${tileWords(hereTile)}` : '')
              : ''}
          </span>
          {here && (
            <span className="tc-qq-listed">
              listed {new Date(here.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              <button type="button" onClick={listAgain} title="List this folder again, to see files added or removed since">
                List again
              </button>
            </span>
          )}
        </div>
      )}

      {scanRun && (
        <ScanStrip
          run={scanRun}
          stalledMs={stalled(scanRun.progress.phase, idleMs) ? idleMs : null}
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
        {view === 'ready' && !shown && !problem && (
          <p className="tc-qq-note">
            Listing "{dir?.name}": {listedSoFar.toLocaleString()} so far, {duration(listSeconds)}.
          </p>
        )}
        {view === 'ready' && shown && (
          <FolderGrid
            key={dirKey}
            arranged={shown}
            tiles={tiles}
            thumbKey={(name) => `${dirKey}/${name}`}
            onOpenDir={(d) => setTrail([...trail, d])}
            onOpenPicture={openPicture}
          />
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
    case 'listing': {
      const where = `Listing "${run.rootName}": ${counted(p.listed, 'file')} in ${counted(p.folders, 'folder')} so far` +
        (p.listingIn ? `; now in "${p.listingIn}".` : '.')
      if (!p.startable) return where
      // Calibrated: the cost of what is listed so far, and Start may go now.
      return `${where} ${counted(left, 'picture')} to read so far` +
        (eta ? `, about ${eta} on this device` : '') +
        '. Start now and the reads keep pace with the listing. Nothing is written until you press Start.'
    }
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
      if (!p.listingDone) {
        return `Reading "${run.rootName}", newest first, while the listing goes on ` +
          `(${counted(p.listed, 'file')} in ${counted(p.folders, 'folder')} so far)` +
          (eta ? `: about ${eta} for what is listed so far.` : '.')
      }
      return `Reading "${run.rootName}", newest first${eta ? `: about ${eta} left` : ''}.`
    case 'pausing':
      return 'Pausing once the reads in flight finish...'
    case 'paused':
      if (!left && p.unsaved) {
        return `Read to the end, but ${counted(p.unsaved, 'entry', 'entries')} could not be saved into the folder; the problems say why. Resume tries again.`
      }
      return `Paused with ${counted(left, 'picture')} to read${p.listingDone ? '' : ' so far; the listing goes on'}. ` +
        'Resume carries on from there.'
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

function stallWords(phase: ScanPhase, ms: number): string {
  const head = `Nothing has moved for ${duration(ms / 1000)}, so the scan has probably stalled. Stop is recommended`
  if (phase === 'listing' || phase === 'indexing' || phase === 'calibrating') return `${head}; nothing has been written yet.`
  return `${head}: it saves what was read once the reads in flight answer. If Stop does not end it, reload the page; ` +
    'what was saved is kept and the next scan carries on from it.'
}

function ScanStrip({
  run, stalledMs, onGo, onPause, onStop, onClose,
}: {
  run: ScanRun
  /** Set when the stall watch fires: how long nothing has moved. */
  stalledMs: number | null
  onGo: () => void
  onPause: () => void
  onStop: () => void
  onClose: () => void
}) {
  const p = run.progress
  const planned = p.startable || !['idle', 'listing', 'indexing', 'calibrating'].includes(p.phase)
  const left = Math.max(0, p.toRead - p.read)
  const num = (n: number) => (planned ? n.toLocaleString() : '-')
  return (
    <section className="tc-qq-scan" aria-label={`Scan of ${run.rootName}`} aria-live="polite">
      <p className="tc-qq-scan-words">{scanWords(run)}</p>
      {p.phase === 'listing' && stalledMs === null && (
        <p className="tc-qq-note">
          Listing a big library can take minutes on a phone or tablet. The count moves as pictures are found; if
          nothing moves for {duration(STALL_MS / 1000)}, this panel says so.
        </p>
      )}
      {stalledMs !== null && <p className="tc-qq-note tc-tone-warn">{stallWords(p.phase, stalledMs)}</p>}
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
        {p.startable && <button type="button" className="tc-pill" onClick={onGo}>Start</button>}
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
      </div>
    </section>
  )
}

function FolderGrid({
  arranged,
  tiles,
  thumbKey,
  onOpenDir,
  onOpenPicture,
}: {
  arranged: Arranged<Handle>
  /** A Scan of this folder: what each folder tile shows of it, by name. */
  tiles: ReadonlyMap<string, TileProgress> | null
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

  const cells = []
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
      const t = tiles?.get(d.name)
      const label = t ? `${d.name}: ${tileWords(t)}` : d.name
      cells.push(
        <button key={`d:${d.name}`} type="button" className="tc-qq-cell" data-kind="dir" style={style} title={label}
          aria-label={label} onClick={() => onOpenDir(d.handle as QqDirHandle)}>
          <span className="tc-qq-folder" aria-hidden="true" />
          <span className="tc-qq-name">{d.name}</span>
          {t && (
            <span className="tc-qq-tile-scan" data-state={t.state} aria-hidden="true">
              <span className="tc-qq-tile-bar" style={{ width: `${t.images ? Math.floor((100 * t.done) / t.images) : 0}%` }} />
              <span className="tc-qq-tile-n">
                {t.done.toLocaleString()}/{t.images.toLocaleString()}{t.listing ? '+' : ''}
              </span>
            </span>
          )}
        </button>,
      )
    } else {
      const e = arranged.images[i - dirCount]
      const imageIndex = i - dirCount
      cells.push(
        <ImageTile key={`f:${e.name}`} name={e.name} handle={e.handle as QqFileHandle} cacheKey={thumbKey(e.name)}
          style={style} onOpen={() => onOpenPicture(imageIndex)} />,
      )
    }
  }

  return (
    <div className="tc-qq-grid" ref={scroller}>
      <div className="tc-qq-canvas" style={{ height: win.totalHeight }}>{cells}</div>
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
