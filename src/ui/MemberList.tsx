import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Room } from 'matrix-js-sdk'
import { useClient } from '../client/ClientContext'
import { startDm } from '../client/dm'
import { describeInviteError } from '../client/userDirectory'
import { UserPicker } from './UserPicker'
import { findExistingDm } from '../client/dm'
import { ProfileCard } from './ProfileCard'
import { ProfileActions } from './ProfileActions'
import { usePresence, type PresenceState } from '../client/usePresence'
import { useMembers } from '../client/useMembers'
import { useMemberBackfill } from '../client/useMemberBackfill'
import { compareByStanding, honorificFor, maxPower, type MergedMember } from '../client/members'
import { useFlipList } from './flip'
import { usePopEnter } from './pop'

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
  const [picker, setPicker] = useState<'dm' | 'invite' | null>(null)
  // One-line result of the last invite/DM. Errors here are the server's own
  // words -- a 403 means insufficient power level and should say so.
  const [notice, setNotice] = useState<string | null>(null)
  // W4.2 -- the open profile card, anchored where the row was clicked.
  const [profile, setProfile] = useState<{ x: number; y: number; userId: string } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Background-hydrate the community roster so All / Nearby fill in (sliding sync
  // ships only $ME per room). Arrivals animate in via the FLIP + pop below.
  useMemberBackfill(client)

  // Member-on-demand (CD-15): sliding sync ships only $ME's membership, so a
  // room's full roster isn't present until we ask for it. Fetch it when a room
  // is opened; the SDK applies it in one batch (out-of-band members), which the
  // member source hears via RoomState.members and repaints once (no re-sort
  // churn). Idempotent -- loadMembersIfNeeded no-ops if already loaded.
  useEffect(() => {
    room?.loadMembersIfNeeded().catch(() => {
      /* transient under sync; a later open or membership event retries */
    })
  }, [room])

  const inRoom = (m: MergedMember) =>
    room ? room.roomId in m.powerByRoom : false

  let shown: MergedMember[]
  if (mode === 'room') {
    shown = room ? members.filter(inRoom) : []
  } else {
    shown = members
  }

  // Honorific tier first, then alphabetical within a tier (W4.1). The FLIP +
  // pop machinery below animates the reorder for free.
  shown = [...shown].sort(compareByStanding)

  // Presence for exactly the rows on screen. Absent = the server said nothing,
  // which is NOT offline (W4.5).
  const presence = usePresence(client, shown.map((m) => m.id))

  // One animation system for every order/membership change: the rows that MOVED
  // slide to their new slot (useFlipList -- the "push"), and rows that just
  // ARRIVED pop into the opened gap (usePopEnter). orderKey changes only on a
  // real change, so stat-only re-renders don't animate.
  const orderKey = shown.map((m) => m.id).join('|')
  useFlipList(listRef, orderKey)
  usePopEnter(listRef, orderKey)

  // Pending knocks, surfaced to anyone whose power can act on them. This is
  // the missing half of "request access": the knock itself always worked
  // server-side; nothing ever SHOWED it to someone who could answer. Approve
  // is an invite (a knocker with an invite may join); deny is the kick,
  // which is how Matrix rejects a knock.
  const myId = client?.getUserId() ?? ''
  const knockers = room ? room.getMembersWithMembership('knock') : []
  const canApprove = !!(room && client && room.canInvite(myId))
  const myPower = room?.getMember(myId)?.powerLevel ?? 0
  const canDeny = !!(room && room.currentState.hasSufficientPowerLevelFor('kick', myPower))
  const answerKnock = (userId: string, approve: boolean) => {
    if (!room || !client) return
    const run = async () => {
      try {
        if (approve) await client.invite(room.roomId, userId)
        else await client.kick(room.roomId, userId, 'Request declined')
        setNotice(approve ? 'Approved -- they can join now.' : 'Request declined.')
      } catch (err) {
        setNotice(describeInviteError(err))
      }
    }
    void run()
  }

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

      <div style={{ display: 'flex', gap: 4, padding: '0 6px 6px' }}>
        <button
          type="button"
          onClick={() => setPicker('dm')}
          title="Start a direct message"
          style={miniBtn}
        >
          + DM
        </button>
        {room && (
          <button
            type="button"
            onClick={() => setPicker('invite')}
            title="Invite someone to this room"
            style={miniBtn}
          >
            + Invite
          </button>
        )}
      </div>

      {room && canApprove && knockers.length > 0 && (
        <div style={{ padding: '0 6px 6px' }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
              color: 'var(--tc-unread, #ff9628)',
              padding: '2px 2px 4px',
            }}
          >
            Requesting access
          </div>
          {knockers.map((m) => (
            <div
              key={m.userId}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 2px', fontSize: 12 }}
            >
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.userId}>
                {m.name || m.userId}
              </span>
              <button type="button" style={miniBtn} onClick={() => answerKnock(m.userId, true)}>
                Approve
              </button>
              {canDeny && (
                <button type="button" style={miniBtn} onClick={() => answerKnock(m.userId, false)}>
                  Deny
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {profile && client && (
        <ProfileCard
          x={profile.x}
          y={profile.y}
          userId={profile.userId}
          room={room}
          member={members.find((m) => m.id === profile.userId)}
          presence={presence.get(profile.userId)}
          actions={
            <ProfileActions
              client={client}
              userId={profile.userId}
              room={room}
              onClose={() => setProfile(null)}
            />
          }
          onClose={() => setProfile(null)}
        />
      )}

      {picker && client && (
        <UserPicker
          client={client}
          title={picker === 'dm' ? 'Start a direct message' : 'Invite to this room'}
          actionLabel={picker === 'dm' ? 'Opening' : 'Inviting'}
          excludeFromRoom={picker === 'invite' ? room : null}
          // Only meaningful for the DM picker: W3.8 reuses an existing DM
          // rather than creating a second one, and the user could not tell
          // that was going to happen until after they clicked.
          existingDmWith={
            picker === 'dm' && client
              ? (userId) => findExistingDm(client, userId) !== null
              : undefined
          }
          onPick={(userId) => {
            const run = async () => {
              try {
                if (picker === 'dm') {
                  const result = await startDm(client, userId)
                  setNotice(
                    result.existing
                      ? 'You already have a direct message with them -- opening it.'
                      : 'Direct message created.',
                  )
                } else if (room) {
                  await client.invite(room.roomId, userId)
                  setNotice('Invite sent.')
                }
                setPicker(null)
              } catch (err) {
                // Surface the server's own reason rather than "it failed".
                setNotice(describeInviteError(err))
                setPicker(null)
              }
            }
            void run()
          }}
          onClose={() => setPicker(null)}
        />
      )}

      {notice && (
        <div
          style={{
            fontSize: 11,
            padding: '4px 8px',
            margin: '0 6px 6px',
            borderRadius: 6,
            background: 'var(--cpd-color-bg-subtle-secondary)',
            color: 'var(--cpd-color-text-secondary)',
          }}
          role="status"
        >
          {notice}{' '}
          <button
            type="button"
            onClick={() => setNotice(null)}
            style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer' }}
            aria-label="Dismiss"
          >
            {'×'}
          </button>
        </div>
      )}

      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '2px 4px' }}>
        <div style={{ fontSize: 11, color: 'var(--cpd-color-text-secondary)', padding: '2px 8px' }}>
          {shown.length} {shown.length === 1 ? 'member' : 'members'}
        </div>
        {shown.map((m) => (
          <MemberRow
            key={m.id}
            member={m}
            room={room}
            mode={mode}
            presence={presence.get(m.id)}
            onOpenProfile={(x, y) => setProfile({ x, y, userId: m.id })}
          />
        ))}
      </div>
    </div>
  )
}

function MemberRow({
  member,
  presence,
  onOpenProfile,
  room,
  mode,
}: {
  member: MergedMember
  presence: PresenceState | undefined
  onOpenProfile: (x: number, y: number) => void
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
      data-flip-id={member.id}
      role="button"
      tabIndex={0}
      onClick={(e) => onOpenProfile(e.clientX, e.clientY)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          const r = e.currentTarget.getBoundingClientRect()
          onOpenProfile(r.left, r.bottom)
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        height: 26,
        padding: '0 8px',
        borderRadius: 6,
        cursor: 'pointer',
        color: nameDimmed
          ? 'var(--cpd-color-text-secondary)'
          : 'var(--cpd-color-text-primary)',
        opacity: nameDimmed ? 0.6 : 1,
      }}
      title={member.id}
    >
      {presence && (
        <span
          className="tc-presence-dot"
          data-presence={presence}
          title={presence === 'online' ? 'Online' : presence === 'unavailable' ? 'Away' : 'Offline'}
          aria-hidden="true"
        />
      )}
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

const miniBtn: CSSProperties = {
  flex: 1,
  fontSize: 11,
  padding: '3px 6px',
  borderRadius: 6,
  border: '1px solid rgba(128,128,128,0.3)',
  background: 'transparent',
  color: 'var(--cpd-color-text-secondary)',
  cursor: 'pointer',
}
