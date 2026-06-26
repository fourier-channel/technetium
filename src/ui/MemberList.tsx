import { useState } from 'react'
import type { Room } from 'matrix-js-sdk'
import { useClient } from '../client/ClientContext'
import { useMembers } from '../client/useMembers'
import { honorificFor, maxPower, type MergedMember } from '../client/members'

type Mode = 'room' | 'all' | 'all-highlight'

// Color per honorific tier. Dimmed variant signals "authority elsewhere".
const HONOR_COLOR: Record<string, string> = {
  '~': 'var(--cpd-color-text-success-primary, #2dbd7e)', // owner
  '@': 'var(--cpd-color-text-info-primary, #4b8bf5)', // op/mod
  '+': 'var(--cpd-color-text-warning-primary, #d4a72c)', // voice
}

export function MemberList({ room }: { room: Room | null }) {
  const { client } = useClient()
  const members = useMembers(client)
  const [mode, setMode] = useState<Mode>('all-highlight')

  const inRoom = (m: MergedMember) =>
    room ? room.roomId in m.powerByRoom : false

  let shown: MergedMember[]
  if (mode === 'room') {
    shown = room ? members.filter(inRoom) : []
  } else {
    shown = members
  }

  shown = [...shown].sort((a, b) =>
    a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()),
  )

  return (
    <div
      style={{
        width: 220,
        flexShrink: 0,
        borderLeft: '1px solid rgba(128,128,128,0.25)',
        display: 'flex',
        flexDirection: 'column',
        color: 'var(--cpd-color-text-primary)',
      }}
    >
      <div style={{ display: 'flex', gap: 2, padding: 6 }}>
        <ModeBtn active={mode === 'room'} onClick={() => setMode('room')}>Room</ModeBtn>
        <ModeBtn active={mode === 'all'} onClick={() => setMode('all')}>All</ModeBtn>
        <ModeBtn active={mode === 'all-highlight'} onClick={() => setMode('all-highlight')}>Nearby</ModeBtn>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '2px 4px' }}>
        <div style={{ fontSize: 11, color: 'var(--cpd-color-text-secondary)', padding: '2px 8px' }}>
          {shown.length} {shown.length === 1 ? 'member' : 'members'}
        </div>
        {shown.map((m) => (
          <MemberRow key={m.id} member={m} room={room} mode={mode} />
        ))}
      </div>
    </div>
  )
}

function MemberRow({
  member,
  room,
  mode,
}: {
  member: MergedMember
  room: Room | null
  mode: Mode
}) {
  // Honorific IDENTITY = highest power the member holds anywhere in the space.
  const identityHonor = honorificFor(maxPower(member))

  // Two INDEPENDENT visual signals — kept decoupled on purpose:
  //   presentHere   -> NAME strength: white when in the viewed room, grey when not.
  //   authorityHere -> BADGE color:   tier color when their rank is backed in THIS
  //                    room, grey when their rank lives in another room.
  // A member can be present here (white name) yet hold authority elsewhere (grey
  // badge). The prior single-flag version chained these together, so fixing the
  // badge dragged the name grey too — that's the regression this undoes.
  const presentHere = !!room && room.roomId in member.powerByRoom
  const plHere = room ? (member.powerByRoom[room.roomId] ?? 0) : 0
  const authorityHere =
    identityHonor !== null && honorificFor(plHere) === identityHonor

  // Does this view honor the current room's context?
  //   'room' / 'all-highlight' -> yes (Server Defaults, honor room-specific).
  //   'all'                    -> no  (Server Defaults, override room-specific):
  //                               everyone full strength regardless of room.
  const honorsRoom = mode === 'room' || mode === 'all-highlight'

  // NAME greys only when honoring the room AND the member isn't in it. Room mode
  // is filtered to present members, so its names are always full strength.
  const nameDimmed = honorsRoom && !presentHere

  // BADGE shows tier color when the room context is overridden ('all') or when
  // the member's authority is backed here; grey otherwise.
  const honorColor = !identityHonor
    ? undefined
    : !honorsRoom || authorityHere
    ? HONOR_COLOR[identityHonor]
    : 'var(--cpd-color-text-secondary)'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        height: 26,
        padding: '0 8px',
        borderRadius: 6,
        color: nameDimmed
          ? 'var(--cpd-color-text-secondary)'
          : 'var(--cpd-color-text-primary)',
        opacity: nameDimmed ? 0.6 : 1,
      }}
      title={member.id}
    >
      <span
        style={{
          width: 12,
          textAlign: 'center',
          fontWeight: 700,
          color: honorColor,
        }}
      >
        {identityHonor ?? ''}
      </span>
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: 13,
        }}
      >
        {member.displayName}
      </span>
    </div>
  )
}

function ModeBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        fontSize: 11,
        padding: '4px 0',
        borderRadius: 6,
        border: 'none',
        cursor: 'pointer',
        background: active
          ? 'var(--cpd-color-bg-action-primary-rest)'
          : 'var(--cpd-color-bg-subtle-secondary)',
        color: active
          ? 'var(--cpd-color-text-on-solid-primary, #fff)'
          : 'var(--cpd-color-text-secondary)',
      }}
    >
      {children}
    </button>
  )
}
