import { useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { MatrixClient } from 'matrix-js-sdk'
import {
  choosable,
  customLevel,
  judgeRoom,
  levelsFromFacts,
  patiently,
  pickKind,
  tally,
  type MembershipRead,
  type Progress,
  type Verdict,
} from '../client/bulkPower'
import { bulkRunFor, dismissBulkRun, startBulkRun, stopBulkRun, subscribeBulkRun } from '../client/bulkRun'
import { createLimiter } from '../client/concurrency'
import { standingLabel, splitUserId } from '../client/members'
import { TIERS } from '../client/powerLevels'
import { powerIO } from '../client/powerWrite'
import { detail } from '../client/report'
import type { RoomFacts, StructureRow } from '../client/serverPermissions'
import { UserPicker } from './UserPicker'

// ---------------------------------------------------------------------------
// Set one person's level in many rooms at once (launch-polish L19).
//
// Operator, 2026-09-30: "it's a pain to go down through each channel just to
// set global mods." Who, then what level, then which rooms -- every row
// saying, before anything is written, what would happen there and why. The
// rules and the run are client/bulkPower.ts; this renders what they return.
//
// Their membership is READ from the server for every room when they are
// picked, because this client syncs only its own membership in each room and
// a roster it happens to have loaded can be behind. The levels in the preview
// are the synced ones; the write reads them again (bulkPower's header says
// why), so a preview that has gone stale can only make a room be skipped with
// its reason, never make it be written wrongly.
//
// A run, once confirmed, is the session's (client/bulkRun.ts): switching to
// Rooms, to another Settings tab, or closing Settings leaves it running, and
// this panel shows it again -- progress or report -- when it next opens.
// ---------------------------------------------------------------------------

// Membership reads in flight at once: enough that forty rooms take a moment,
// few enough not to be a burst the homeserver notices.
const READS_AT_ONCE = 4

// Offered as the starting level because it is what the tool was asked for;
// pressed, so it reads as a choice and not as a blank (formant rule 4).
const START_LEVEL = 50

type Phase = 'choose' | 'confirm'

function rank(level: number): string {
  return `${standingLabel(level)} ${level}`
}

export function BulkLevels({
  client,
  rows,
  onWritten,
}: {
  client: MatrixClient
  rows: StructureRow[]
  onWritten: () => void
}) {
  const me = client.getUserId() ?? ''
  const runState = useSyncExternalStore(subscribeBulkRun, () => bulkRunFor(me))
  // A run already here when the panel opens brings its person and level back.
  const [target, setTarget] = useState<string | null>(() => bulkRunFor(me)?.target ?? null)
  const [picking, setPicking] = useState(false)
  const [tierLevel, setTierLevel] = useState(() => bulkRunFor(me)?.to ?? START_LEVEL)
  const [custom, setCustom] = useState('')
  const [memberships, setMemberships] = useState<ReadonlyMap<string, MembershipRead>>(new Map())
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [local, setLocal] = useState<Phase>('choose')
  // Which pick the membership reads in flight belong to; a read that lands
  // after somebody else was picked is dropped rather than shown against them.
  const generation = useRef(0)

  const typed = customLevel(custom)
  // Null while the box holds something that is not a level: no verdicts, and
  // nothing can be confirmed, rather than a level the box does not show.
  const level = typed.kind === 'empty' ? tierLevel : typed.kind === 'level' ? typed.level : null
  // A confirm whose level has since become unreadable goes back to choosing.
  const phase = runState ? runState.phase : local === 'confirm' && level === null ? 'choose' : local
  const progress = runState?.progress ?? EMPTY_PROGRESS
  // The rooms a run was started on, fixed when it starts. The preview keeps
  // moving underneath it -- sync delivers each new level as it lands, which
  // turns a written room's verdict into "already" -- and the count of a run
  // must not move with it.
  const ran = runState?.ran ?? NO_ROOMS

  // A room under two spaces is two rows and one room.
  const rooms = useMemo(() => {
    const byId = new Map<string, RoomFacts>()
    for (const r of rows) byId.set(r.room.roomId, r.room)
    return byId
  }, [rows])

  const verdicts = useMemo(() => {
    const out = new Map<string, Verdict>()
    if (!target || level === null) return out
    for (const [roomId, room] of rooms) {
      out.set(roomId, judgeRoom(levelsFromFacts(room, me, target), memberships.get(roomId) ?? null, level, target === me))
    }
    return out
  }, [rooms, me, target, memberships, level])

  // What is chosen is what is selected AND still possible: changing the level
  // can make a selected room impossible, and it must drop out of the count
  // rather than be written to and refused.
  const order = useMemo(() => [...rooms.keys()], [rooms])
  const chosen = order.filter((id) => selected.has(id) && choosable(verdicts.get(id) ?? { kind: 'reading' }))
  const reading = target ? order.filter((id) => verdicts.get(id)?.kind === 'reading').length : 0
  const waits = chosen.filter((id) => { const v = verdicts.get(id); return v?.kind === 'change' && v.waits }).length
  const ownLevel = chosen.filter((id) => { const v = verdicts.get(id); return v?.kind === 'change' && v.ownLevel }).length

  const failedReads = order.filter((id) => typeof memberships.get(id) === 'object').length

  // Each read waits out a rate limit the way the run does: forty rooms read at
  // once is exactly when a homeserver asks for a pause.
  const readMemberships = (userId: string, only?: readonly string[]) => {
    const gen = ++generation.current
    const ids = only ?? order
    setMemberships((cur) => {
      if (!only) return new Map()
      const next = new Map(cur)
      for (const id of ids) next.delete(id)
      return next
    })
    const io = powerIO(client)
    const limiter = createLimiter(READS_AT_ONCE)
    const superseded = () => gen !== generation.current
    for (const roomId of ids) {
      void limiter.run(() => patiently(() => io.readMembership(roomId, userId), io.sleep, superseded, () => {}, () => {})).then(
        (m) => {
          if (gen === generation.current) setMemberships((cur) => new Map(cur).set(roomId, m))
        },
        (err) => {
          if (gen === generation.current) setMemberships((cur) => new Map(cur).set(roomId, { error: detail(err) }))
        },
      )
    }
  }

  const pick = (userId: string) => {
    dismissBulkRun()
    setPicking(false)
    setTarget(userId)
    setSelected(new Set())
    setLocal('choose')
    readMemberships(userId)
  }

  const toggle = (roomId: string) =>
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(roomId)) next.delete(roomId)
      else next.add(roomId)
      return next
    })

  const addKind = (kind: 'rooms' | 'spaces') => {
    const add = pickKind([...rooms.values()], verdicts, kind)
    setSelected((cur) => new Set([...cur, ...add]))
  }

  const run = async () => {
    if (!target || level === null || chosen.length === 0) return
    const job = {
      me,
      target,
      to: level,
      rooms: chosen.map((id) => {
        const r = rooms.get(id)!
        return { roomId: id, isSpace: r.isSpace, creators: r.creators }
      }),
    }
    setLocal('choose')
    await startBulkRun(job, powerIO(client))
  }

  const again = () => {
    dismissBulkRun()
    setSelected(new Set())
    setLocal('choose')
    onWritten()
    if (target) readMemberships(target)
  }

  const name = target ? (client.getUser(target)?.displayName || splitUserId(target).uname) : ''
  const t = tally(progress)
  const busy = phase === 'run'
  const finished = t.done + t.skipped + t.failed

  return (
    <div className="tc-bulk">
      <section className="tc-bulk-step" aria-label="Whose level">
        <span className="tc-bulk-label">Who</span>
        {target ? (
          <span className="tc-bulk-who">
            <strong>{name}</strong>
            <code className="tc-bulk-id">{target}</code>
          </span>
        ) : (
          <span className="tc-perm-dim">Nobody chosen yet.</span>
        )}
        <button type="button" className="tc-pill" disabled={busy} onClick={() => setPicking(true)}>
          {target ? 'Change' : 'Choose someone'}
        </button>
      </section>

      <section className="tc-bulk-step" aria-label="Which level">
        <span className="tc-bulk-label">Level</span>
        <span className="tc-bulk-levels" role="radiogroup" aria-label="Power level">
          {TIERS.map((tier) => (
            <button
              key={tier.level}
              type="button"
              role="radio"
              className="tc-pill"
              aria-checked={level === tier.level}
              disabled={busy}
              onClick={() => { setTierLevel(tier.level); setCustom('') }}
            >
              {tier.label} {tier.level}
            </button>
          ))}
          <label className="tc-bulk-other">
            or
            <input
              type="number"
              className="tc-input"
              min={0}
              max={100}
              step={1}
              value={custom}
              placeholder="level"
              aria-label="Any other power level, 0 to 100"
              disabled={busy}
              aria-invalid={typed.kind === 'invalid'}
              onChange={(e) => setCustom(e.target.value)}
            />
          </label>
          {typed.kind === 'invalid' && (
            <span className="tc-tone-bad" role="alert">A level is a whole number from 0 to 100.</span>
          )}
        </span>
      </section>

      {target && (
        <>
          <section className="tc-bulk-step" aria-label="Which rooms">
            <span className="tc-bulk-label">Where</span>
            <span className="tc-bulk-picks">
              <button type="button" className="tc-pill" disabled={busy} onClick={() => addKind('rooms')}>Every room</button>
              <button type="button" className="tc-pill" disabled={busy} onClick={() => addKind('spaces')}>Every space</button>
              <button type="button" className="tc-pill" disabled={busy || selected.size === 0} onClick={() => setSelected(new Set())}>Clear</button>
              {reading > 0 && (
                <span className="tc-tone-active">Reading their membership: {order.length - reading} of {order.length}</span>
              )}
              {reading === 0 && failedReads > 0 && !busy && (
                <button
                  type="button"
                  className="tc-pill"
                  onClick={() => readMemberships(target, order.filter((id) => typeof memberships.get(id) === 'object'))}
                >
                  Read again ({failedReads} unread)
                </button>
              )}
            </span>
          </section>

          <ul className="tc-bulk-list">
            {rows.map((row) => {
              const id = row.room.roomId
              const v = verdicts.get(id) ?? { kind: 'reading' as const }
              const p = progress.get(id)
              const can = choosable(v)
              return (
                <li key={`${row.underSpaceId ?? 'root'}:${id}`} className="tc-bulk-row" data-can={can ? 'true' : 'false'}>
                  <label style={{ paddingLeft: row.depth * 14 }}>
                    <input
                      type="checkbox"
                      checked={can && selected.has(id)}
                      disabled={!can || busy || phase === 'done'}
                      onChange={() => toggle(id)}
                    />
                    <span className="tc-perm-kind">{row.room.isSpace ? 'SPACE' : 'ROOM'}</span>
                    <span className="tc-bulk-name">{row.room.name}</span>
                  </label>
                  {p ? <ProgressLine p={p} /> : <VerdictLine v={v} />}
                </li>
              )
            })}
          </ul>

          <div className="tc-bulk-foot" role="status">
            {phase === 'choose' && (
              <>
                <span>
                  {level === null
                    ? 'Choose a level first.'
                    : chosen.length === 0
                      ? 'Tick the rooms to change, or use Every room.'
                      : `${chosen.length} chosen.`}
                </span>
                <button type="button" className="tc-pill" disabled={level === null || chosen.length === 0} onClick={() => setLocal('confirm')}>
                  Set in {chosen.length}
                </button>
              </>
            )}
            {phase === 'confirm' && (
              <>
                <span className="tc-bulk-confirm">
                  Set {name} to {rank(level ?? 0)} in {chosen.length} {chosen.length === 1 ? 'place' : 'places'}?
                  {ownLevel > 0 && (
                    <span className="tc-tone-warn">
                      {' '}In {ownLevel} of them that is your own level, and you will not be able to lower them there again.
                    </span>
                  )}
                  {waits > 0 && (
                    <span className="tc-perm-dim">
                      {' '}In {waits} they are not a member yet; it applies when they join.
                    </span>
                  )}
                </span>
                <button type="button" className="tc-pill" data-tone="go" onClick={() => void run()}>Yes, set it</button>
                <button type="button" className="tc-pill" onClick={() => setLocal('choose')}>Cancel</button>
              </>
            )}
            {phase === 'run' && (
              <>
                <span className="tc-tone-active">
                  {runState?.stopping
                    ? `Stopping -- finishing the room in hand. ${finished} of ${ran.length} done.`
                    : `Setting ${Math.min(finished + 1, ran.length)} of ${ran.length}...`}
                </span>
                <button type="button" className="tc-pill" disabled={runState?.stopping} onClick={stopBulkRun}>
                  {runState?.stopping ? 'Stopping' : 'Stop'}
                </button>
              </>
            )}
            {phase === 'done' && (
              <>
                <span>
                  <span className={t.done > 0 ? 'tc-tone-ok' : undefined}>Set in {t.done}.</span>
                  {t.skipped > 0 && <span className="tc-tone-warn"> {t.skipped} skipped.</span>}
                  {t.failed > 0 && <span className="tc-tone-bad"> {t.failed} failed.</span>}
                  {' '}Each row says why.
                </span>
                <button type="button" className="tc-pill" onClick={again}>Start again</button>
              </>
            )}
          </div>
        </>
      )}

      {picking && (
        <UserPicker
          client={client}
          title="Whose level?"
          actionLabel="Reading"
          onPick={pick}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  )
}

const EMPTY_PROGRESS: ReadonlyMap<string, Progress> = new Map()
const NO_ROOMS: readonly string[] = []

function VerdictLine({ v }: { v: Verdict }) {
  switch (v.kind) {
    case 'reading':
      return <span className="tc-bulk-say tc-perm-dim">reading...</span>
    case 'same':
      return <span className="tc-bulk-say tc-perm-dim">already {rank(v.level)}</span>
    case 'blocked':
      return <span className="tc-bulk-say tc-perm-dim">{v.reason}</span>
    case 'change':
      return (
        <span className="tc-bulk-say">
          {rank(v.from)} {'\u2192'} {rank(v.to)}
          {v.waits && <span className="tc-perm-dim"> -- not in it yet; waits for them to join</span>}
          {v.ownLevel && <span className="tc-tone-warn"> -- your own level; you cannot lower them again here</span>}
        </span>
      )
  }
}

function ProgressLine({ p }: { p: Progress }) {
  switch (p.kind) {
    case 'queued':
      return <span className="tc-bulk-say tc-perm-dim">in line</span>
    case 'working':
      return <span className="tc-bulk-say tc-tone-active">setting...</span>
    case 'waiting':
      return <span className="tc-bulk-say tc-tone-active">the server asked for a pause; retrying in {Math.ceil(p.ms / 1000)}s</span>
    case 'done':
      return (
        <span className="tc-bulk-say tc-tone-ok">
          done: {rank(p.from)} {'\u2192'} {rank(p.to)}{p.waits ? ', waiting for them to join' : ''}
        </span>
      )
    case 'skipped':
      return <span className="tc-bulk-say tc-tone-warn">skipped: {p.reason}</span>
    case 'failed':
      return <span className="tc-bulk-say tc-tone-bad">failed: {p.reason}</span>
  }
}
