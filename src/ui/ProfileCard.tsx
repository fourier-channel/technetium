import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Room } from 'matrix-js-sdk'
import { AuthedImage } from './AuthedImage'
import { presenceLabel, type PresenceState } from '../client/usePresence'
import {
  initials,
  maxPower,
  splitUserId,
  standingLabel,
  type MergedMember,
} from '../client/members'

// ---------------------------------------------------------------------------
// S5 -- the shared profile card.
//
// Lifted out of DomainUserMenu, which grew the original as a domain-mode
// "Inspect" popup. It was never actually domain-specific: it only ever read
// room.getMember(userId). Promoting it means the member list (Wave 4) and the
// message sender pillbox (Wave 4) open the SAME card, and the profile-editing
// and block/ignore actions have one place to land.
//
// Two identity sources, in priority order:
//   1. `room` -- a RoomMember, when the card is opened somewhere with a room in
//      hand (domain canvas, timeline, member list in room mode). Gives the
//      per-room display name, avatar and power level.
//   2. `member` -- a MergedMember, for the member list's "All"/"Nearby" modes
//      where the person may not be in the room being viewed. Power comes from
//      maxPower (their standing anywhere in the space), not a room PL.
// At least one must be supplied; with neither, the card degrades to the raw
// user id rather than rendering something false.
//
// `actions` is the slot Wave 3/4 fill with Message / Invite / Block, so those
// features never have to reopen this component's internals.
// ---------------------------------------------------------------------------

const CARD_W = 250

export function ProfileCard({
  x,
  y,
  userId,
  room = null,
  member,
  presence,
  actions,
  onClose,
}: {
  x: number
  y: number
  userId: string
  room?: Room | null
  member?: MergedMember
  // W4.5 -- undefined means the server told us nothing, which is NOT offline.
  // The status line is then absent rather than claiming a state.
  presence?: PresenceState
  actions?: ReactNode
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  const roomMember = room?.getMember(userId) ?? null
  const name = roomMember?.name || member?.displayName || userId
  const avatarMxc = roomMember?.getMxcAvatarUrl() ?? member?.avatarMxc ?? null
  // In a room, standing is that room's power level. Without one, fall back to
  // the member's highest standing anywhere in the space.
  const pl = roomMember ? roomMember.powerLevel : member ? maxPower(member) : 0
  const standing = standingLabel(pl)
  const { uname, server } = splitUserId(userId)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const left = Math.max(6, Math.min(x, window.innerWidth - CARD_W - 8))
  const top = Math.max(6, Math.min(y, window.innerHeight - 190))

  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left,
        top,
        width: CARD_W,
        zIndex: 1001,
        padding: 14,
        borderRadius: 12,
        fontFamily: 'var(--tc-ui-font, inherit)',
        color: 'var(--cpd-color-text-primary)',
        background: 'var(--cpd-color-bg-canvas-default)',
        border: '1px solid rgba(128,128,128,0.35)',
        boxShadow: '0 12px 34px rgba(0,0,0,0.5)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            overflow: 'hidden',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
            fontSize: 20,
            fontWeight: 700,
            color: '#fff',
            background: 'var(--cpd-color-bg-subtle-primary)',
          }}
        >
          {avatarMxc ? (
            <AuthedImage
              mxc={avatarMxc}
              width={180}
              fill
              transparentLoading
              alt=""
              fallback={initials(name)}
              viaHomeserver
            />
          ) : (
            initials(name)
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--cpd-color-text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {uname}
            {server ? <span style={{ opacity: 0.7 }}>:{server}</span> : null}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Tag>{standing}</Tag>
        <Tag>PL {pl}</Tag>
        {presenceLabel(presence) && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              color: 'var(--cpd-color-text-secondary)',
            }}
          >
            <span className="tc-presence-dot" data-presence={presence} aria-hidden="true" />
            {presenceLabel(presence)}
          </span>
        )}
      </div>

      {actions ? (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {actions}
        </div>
      ) : null}
    </div>,
    document.body,
  )
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 999,
        background: 'var(--cpd-color-bg-subtle-secondary)',
        color: 'var(--cpd-color-text-primary)',
      }}
    >
      {children}
    </span>
  )
}
