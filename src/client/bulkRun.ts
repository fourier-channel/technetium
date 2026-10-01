import { runBulk, type BulkIO, type BulkJob, type Progress } from './bulkPower'

// ---------------------------------------------------------------------------
// The bulk setter's run, held outside the panel that started it (L19).
//
// A run used to live in BulkLevels' own state, and the panel's unmount stopped
// it -- so clicking the Rooms pill, another Settings tab, or closing Settings
// halted a confirmed run after the room in hand and threw its report away:
// some rooms written, the rest not, and nothing anywhere saying which. The
// user had confirmed "set them in these rooms"; carrying that out is what
// they asked for, and the one way to halt it is Stop.
//
// So the run belongs to the session. The panel shows whatever run is here
// when it opens -- in progress or finished -- until Start again dismisses it.
// One run at a time, and only to the account that started it: a different
// sign-in in this tab never sees another account's run.
//
// Pure apart from the timers inside `io`, so the checks drive it (O-tp9).
// ---------------------------------------------------------------------------

export interface BulkRun {
  me: string
  target: string
  to: number
  // The rooms it was started on, fixed at the start (see BulkLevels).
  ran: readonly string[]
  progress: ReadonlyMap<string, Progress>
  phase: 'run' | 'done'
  // Stop was pressed and is being honoured: shown at once, because the run
  // only halts after the room in hand (or its rate-limit pause) ends.
  stopping: boolean
  // Rooms written so far; a reader that shows room levels re-reads on it.
  written: number
}

let current: BulkRun | null = null
const listeners = new Set<() => void>()

function publish(next: BulkRun | null) {
  current = next
  for (const l of listeners) l()
}

export function subscribeBulkRun(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// The run for this account, or null. A stable object between changes, as
// useSyncExternalStore requires.
export function bulkRunFor(me: string): BulkRun | null {
  return current && current.me === me ? current : null
}

export function bulkRunning(): boolean {
  return current?.phase === 'run'
}

export async function startBulkRun(job: BulkJob, io: BulkIO): Promise<void> {
  if (bulkRunning()) throw new Error('A bulk run is already in progress; stop it or let it finish first.')
  publish({
    me: job.me,
    target: job.target,
    to: job.to,
    ran: job.rooms.map((r) => r.roomId),
    progress: new Map(),
    phase: 'run',
    stopping: false,
    written: 0,
  })
  const mine = current
  const update = (roomId: string, p: Progress) => {
    if (!current || current.ran !== mine?.ran) return
    publish({
      ...current,
      progress: new Map(current.progress).set(roomId, p),
      written: current.written + (p.kind === 'done' ? 1 : 0),
    })
  }
  await runBulk(job, io, update, () => !!current?.stopping)
  if (current && current.ran === mine?.ran) publish({ ...current, phase: 'done' })
}

export function stopBulkRun(): void {
  if (current?.phase === 'run' && !current.stopping) publish({ ...current, stopping: true })
}

// Start again: forget a FINISHED run. A run in progress is not dismissed --
// it would carry on writing with nothing on screen to say so.
export function dismissBulkRun(): void {
  if (current && current.phase === 'done') publish(null)
}
