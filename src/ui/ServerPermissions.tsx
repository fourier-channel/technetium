import { useMemo, useState } from 'react'
import type { MatrixClient } from 'matrix-js-sdk'
import { readRoomFacts } from '../client/roomFacts'
import {
  DEFAULT_RANGE,
  auditRooms,
  findingsFor,
  normaliseRange,
  structure,
  usersInRange,
  type Finding,
  type RoomFacts,
} from '../client/serverPermissions'
import { powerEdit, requiredToSetPower, TIERS } from '../client/powerLevels'
import { describeInviteError } from '../client/userDirectory'
import { standingLabel, splitUserId } from '../client/members'

// ---------------------------------------------------------------------------
// The Server Permissions panel (ui-depth-v1 U8).
//
// Every space and room the account is in, nested as the server has them and
// alphabetised at every level; each one's settings at a glance; everyone
// holding power inside a window the operator sets; and a way to move somebody
// between the ranks without going and finding them in a member list first.
//
// The audit beside it answers "is everything holding the right settings", and
// it answers it in two registers that are never mixed: FAULTS, which are true
// of any Matrix room regardless of taste, and DIFFERENCES from the rest of this
// server, which are information and are never called faults. The rules are in
// client/serverPermissions.ts with 60 checks on them; this file renders what
// they return.
//
// Nothing here is fetched. It is the state the client already syncs, which is
// also why this is a VIEW and not a privilege: see client/serverAdmin.ts.
// ---------------------------------------------------------------------------

export function ServerPermissions({ client }: { client: MatrixClient }) {
  const [low, setLow] = useState(DEFAULT_RANGE.low)
  const [high, setHigh] = useState(DEFAULT_RANGE.high)
  const [open, setOpen] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [onlyFindings, setOnlyFindings] = useState(false)

  // Re-read on demand rather than subscribing to every room's state: this is a
  // settings panel somebody opens to look at, not a live surface, and a
  // subscription across every room in the account would repaint it on every
  // message anyone sends.
  // `reload` is the whole point of the dependency and the linter cannot see it:
  // readRoomFacts reads mutable SDK state, so nothing in the argument list
  // changes when the answer does. Bumping the counter IS the re-read.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const facts = useMemo(() => readRoomFacts(client), [client, reload])
  const audit = useMemo(() => auditRooms(facts), [facts])
  const rows = useMemo(() => structure(facts), [facts])
  const range = normaliseRange(low, high)

  const withFindings = new Set(audit.findings.map((f) => f.roomId))
  const shown = onlyFindings ? rows.filter((r) => withFindings.has(r.room.roomId)) : rows

  const hardCount = audit.findings.filter((f) => f.kind === 'hard').length
  const outlierCount = audit.findings.length - hardCount

  return (
    <div className="tc-perm">
      <div className="tc-perm-bar">
        <label className="tc-perm-range">
          Power from
          <input
            type="number"
            value={low}
            min={0}
            max={100}
            aria-label="Lowest power level to list"
            onChange={(e) => setLow(Number(e.target.value))}
          />
          to
          <input
            type="number"
            value={high}
            min={0}
            max={100}
            aria-label="Highest power level to list"
            onChange={(e) => setHigh(Number(e.target.value))}
          />
        </label>
        <button
          type="button"
          className="tc-perm-chip"
          aria-pressed={onlyFindings}
          onClick={() => setOnlyFindings((o) => !o)}
        >
          {onlyFindings ? 'Showing only flagged' : 'Show only flagged'}
        </button>
        <button type="button" className="tc-perm-chip" onClick={() => setReload((n) => n + 1)}>
          Re-read
        </button>
      </div>

      <div className="tc-perm-summary">
        {/* Both numbers, always, and the denominator with them. "0 faults" on
            its own is the shape of answer that hides a pass that never ran. */}
        <span className={hardCount > 0 ? 'tc-tone-bad' : 'tc-tone-ok'}>
          {hardCount} fault{hardCount === 1 ? '' : 's'}
        </span>
        <span className="tc-perm-dim">
          {outlierCount} difference{outlierCount === 1 ? '' : 's'} from the rest of the server
        </span>
        <span className="tc-perm-dim">
          across {audit.auditedRooms} room{audit.auditedRooms === 1 ? '' : 's'}
          {audit.skippedDms > 0 ? `, ${audit.skippedDms} direct message${audit.skippedDms === 1 ? '' : 's'} not audited` : ''}
        </span>
        {audit.consensusSkipped && (
          <span className="tc-tone-warn">
            Too few rooms to say what the rest of the server does, so nothing is compared. This is
            not a clean bill.
          </span>
        )}
      </div>

      {notice && <div className="tc-perm-notice" role="status">{notice}</div>}

      <div className="tc-perm-list">
        {shown.length === 0 && (
          <div className="tc-perm-dim" style={{ padding: 10 }}>
            {onlyFindings ? 'Nothing is flagged.' : 'No rooms.'}
          </div>
        )}
        {shown.map((row) => (
          <RoomRow
            key={`${row.underSpaceId ?? 'root'}:${row.room.roomId}`}
            client={client}
            room={row.room}
            depth={row.depth}
            findings={findingsFor(audit, row.room.roomId)}
            range={range}
            open={open === `${row.underSpaceId ?? 'root'}:${row.room.roomId}`}
            onToggle={() =>
              setOpen((cur) => {
                const key = `${row.underSpaceId ?? 'root'}:${row.room.roomId}`
                return cur === key ? null : key
              })
            }
            onChanged={(msg) => {
              setNotice(msg)
              setReload((n) => n + 1)
            }}
          />
        ))}
      </div>
    </div>
  )
}

function RoomRow({
  client,
  room,
  depth,
  findings,
  range,
  open,
  onToggle,
  onChanged,
}: {
  client: MatrixClient
  room: RoomFacts
  depth: number
  findings: Finding[]
  range: { low: number; high: number }
  open: boolean
  onToggle: () => void
  onChanged: (msg: string) => void
}) {
  const holders = usersInRange(room, range.low, range.high)
  const faults = findings.filter((f) => f.kind === 'hard').length

  return (
    <div className="tc-perm-room" data-open={open ? 'true' : 'false'}>
      <button
        type="button"
        className="tc-perm-head"
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="tc-perm-kind">{room.isSpace ? 'SPACE' : room.isDm ? 'DM' : 'ROOM'}</span>
        <span className="tc-perm-name" title={room.roomId}>{room.name}</span>
        <span className="tc-perm-dim">{room.memberCount}</span>
        <span className="tc-perm-dim">{holders.length} with power</span>
        {faults > 0 && <span className="tc-perm-flag tc-tone-bad">{faults}</span>}
        {findings.length > faults && (
          <span className="tc-perm-flag tc-tone-warn">{findings.length - faults}</span>
        )}
        <span aria-hidden="true" className="tc-perm-caret">{open ? '-' : '+'}</span>
      </button>

      {open && (
        <div className="tc-perm-body">
          <dl className="tc-perm-settings">
            <Setting label="join" value={room.joinRule} />
            <Setting label="history" value={room.historyVisibility} />
            <Setting label="guests" value={room.guestAccess} />
            <Setting label="encrypted" value={room.encrypted ? 'yes' : 'no'} />
            <Setting label="default level" value={String(room.usersDefault)} />
            <Setting label="post" value={String(room.eventsDefault)} />
            <Setting label="settings" value={String(room.stateDefault)} />
            <Setting label="invite" value={String(room.invite)} />
            <Setting label="remove" value={String(room.kick)} />
            <Setting label="ban" value={String(room.ban)} />
            <Setting label="delete" value={String(room.redact)} />
            <Setting label="power levels" value={String(room.powerLevelsRequired)} />
          </dl>

          {findings.length > 0 && (
            <ul className="tc-perm-findings">
              {findings.map((f, i) => (
                <li key={i} className={f.kind === 'hard' ? 'tc-tone-bad' : 'tc-tone-warn'}>
                  <strong>{f.kind === 'hard' ? 'Fault' : 'Differs'}:</strong> {f.what}{' '}
                  <span className="tc-perm-dim">{f.why}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="tc-perm-holders">
            {holders.length === 0 ? (
              <div className="tc-perm-dim">
                Nobody between {range.low} and {range.high} here.
              </div>
            ) : (
              holders.map((u) => (
                <HolderRow
                  key={u.userId}
                  client={client}
                  room={room}
                  userId={u.userId}
                  level={u.level}
                  onChanged={onChanged}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// One label/value pair, wrapped. A bare <dt>/<dd> pair inside a grid becomes
// TWO grid items -- each blockified into its own cell -- so the labels and the
// values flowed across the columns independently of each other. A div is legal
// inside a <dl> and keeps the pair together.
function Setting({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="tc-perm-setting">
      <dt>{label}</dt>
      <dd>{value ?? 'not set'}</dd>
    </div>
  )
}

// One person's rank in one room, with the ranks they can be moved to. The same
// rules as the profile card's editor, from the same module -- a second copy
// here would be two things that agree today (D-tc01).
function HolderRow({
  client,
  room,
  userId,
  level,
  onChanged,
}: {
  client: MatrixClient
  room: RoomFacts
  userId: string
  level: number
  onChanged: (msg: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState<number | null>(null)
  const live = client.getRoom(room.roomId)
  const myId = client.getUserId() ?? ''
  const me = live?.getMember(myId) ?? null
  const target = live?.getMember(userId) ?? null
  const facts = powerEdit({
    isSelf: userId === myId,
    haveRoom: !!live,
    inRoom: target?.membership === 'join',
    myLevel: me?.powerLevel ?? 0,
    targetLevel: level,
    requiredToSet: requiredToSetPower(live?.currentState.getStateEvents('m.room.power_levels', '')?.getContent()),
    isSpace: room.isSpace,
  })
  const { uname } = splitUserId(userId)

  const apply = async (to: number) => {
    setBusy(true)
    try {
      await client.setPowerLevel(room.roomId, userId, to)
      onChanged(`${uname} is now ${standingLabel(to)} in ${room.name}.`)
    } catch (err) {
      onChanged(describeInviteError(err))
    } finally {
      setBusy(false)
      setArmed(null)
    }
  }

  return (
    <div className="tc-perm-holder">
      <span className="tc-perm-holder-name" title={userId}>{uname}</span>
      <span className="tc-perm-holder-rank">{standingLabel(level)} {level}</span>
      {facts.blocked ? (
        <span className="tc-perm-dim tc-perm-holder-why">{facts.blocked}</span>
      ) : (
        <span className="tc-perm-holder-set">
          {TIERS.filter((t) => facts.options.some((o) => o.level === t.level)).map((t) => (
            <button
              key={t.level}
              type="button"
              disabled={busy || t.level === level}
              data-armed={armed === t.level ? 'true' : 'false'}
              onClick={() => (armed === t.level ? void apply(t.level) : setArmed(t.level))}
              title={`Power level ${t.level}`}
            >
              {armed === t.level ? 'Confirm' : t.label}
            </button>
          ))}
        </span>
      )}
    </div>
  )
}
