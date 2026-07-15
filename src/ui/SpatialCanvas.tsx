import { useRef, type CSSProperties } from 'react'
import type { MatrixClient, Room } from 'matrix-js-sdk'
import { useSpatialPositions, type SpatialPos } from '../client/useSpatialPositions'
import { useSpatialBubbles, type Bubble } from '../client/useSpatialBubbles'
import { AuthedImage } from './AuthedImage'

// ---------------------------------------------------------------------------
// Spatial canvas: a grid "room" where each participant is an avatar puck at a
// normalized position. Click anywhere to move yourself there; your puck (and,
// when their events arrive, others') travels smoothly to the spot.
//
// Positions come from useSpatialPositions (timeline-event transport). Bubbles,
// backdrop, and the avatar-change menu layer on in later steps.
// ---------------------------------------------------------------------------

const AVATAR_SIZE = 44

function reduceMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

// Deterministic puck color from a user id (fallback when no avatar image).
function colorFor(userId: string): string {
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) % 360
  return `hsl(${h}, 55%, 45%)`
}

function initialsFor(name: string): string {
  const cleaned = name.replace(/^[@#!]/, '').trim()
  return cleaned.slice(0, 2).toUpperCase() || '?'
}

export function SpatialCanvas({ client, room }: { client: MatrixClient; room: Room }) {
  const { positions, myUserId, setMyPosition } = useSpatialPositions(client, room)
  const bubbles = useSpatialBubbles(client, room)
  const ref = useRef<HTMLDivElement>(null)
  const placedSelf = myUserId != null && positions.has(myUserId)

  const onClick = (e: React.MouseEvent) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setMyPosition((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
  }

  return (
    <div
      ref={ref}
      onClick={onClick}
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        cursor: 'pointer',
        // Techy grid: two layers of thin lines over the canvas background.
        backgroundColor: 'var(--cpd-color-bg-canvas-default)',
        backgroundImage:
          'linear-gradient(rgba(128,128,128,0.16) 1px, transparent 1px),' +
          'linear-gradient(90deg, rgba(128,128,128,0.16) 1px, transparent 1px)',
        backgroundSize: '32px 32px, 32px 32px',
      }}
    >
      <style>{`
        @keyframes spatialBubbleIn {
          from { opacity: 0; transform: translate(-50%, 4px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
      {!placedSelf && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            pointerEvents: 'none',
            color: 'var(--cpd-color-text-secondary)',
            fontFamily: 'var(--tc-ui-font, inherit)',
            fontSize: 14,
          }}
        >
          Click anywhere to place yourself
        </div>
      )}
      {[...positions.entries()].map(([userId, pos]) => (
        <SpatialAvatar
          key={userId}
          room={room}
          userId={userId}
          pos={pos}
          isSelf={userId === myUserId}
          bubble={bubbles.get(userId)}
        />
      ))}
    </div>
  )
}

function SpatialAvatar({
  room,
  userId,
  pos,
  isSelf,
  bubble,
}: {
  room: Room
  userId: string
  pos: SpatialPos
  isSelf: boolean
  bubble?: Bubble
}) {
  const member = room.getMember(userId)
  const name = member?.name || userId
  const avatarMxc = member?.getMxcAvatarUrl() ?? null
  const travel = reduceMotion() ? undefined : 'left 380ms cubic-bezier(0.2,0.8,0.2,1), top 380ms cubic-bezier(0.2,0.8,0.2,1)'

  const puck: CSSProperties = {
    position: 'absolute',
    left: `${pos.x * 100}%`,
    top: `${pos.y * 100}%`,
    transform: 'translate(-50%, -50%)',
    transition: travel,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 3,
    pointerEvents: 'none',
  }

  const disc: CSSProperties = {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: '50%',
    overflow: 'hidden',
    display: 'grid',
    placeItems: 'center',
    fontSize: 15,
    fontWeight: 700,
    color: '#fff',
    background: colorFor(userId),
    boxShadow: isSelf
      ? '0 0 0 2px var(--cpd-color-bg-canvas-default), 0 0 0 4px #ff9a3c, 0 4px 12px rgba(0,0,0,0.4)'
      : '0 0 0 2px var(--cpd-color-bg-canvas-default), 0 3px 10px rgba(0,0,0,0.35)',
  }

  return (
    <div style={puck}>
      {bubble && (
        <div
          key={bubble.id}
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            marginBottom: 6,
            transform: 'translateX(-50%)',
            maxWidth: 220,
            width: 'max-content',
            padding: '6px 10px',
            borderRadius: 12,
            fontFamily: 'var(--tc-ui-font, inherit)',
            fontSize: 12,
            lineHeight: 1.35,
            color: 'var(--cpd-color-text-primary)',
            background: 'var(--cpd-color-bg-canvas-default)',
            border: '1px solid rgba(128,128,128,0.35)',
            boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
            whiteSpace: 'normal',
            wordBreak: 'break-word',
            animation: 'spatialBubbleIn 200ms ease-out',
          }}
        >
          {bubble.text}
        </div>
      )}
      <div style={disc}>
        {avatarMxc ? (
          <AuthedImage mxc={avatarMxc} width={180} fill transparentLoading alt="" />
        ) : (
          initialsFor(name)
        )}
      </div>
      <div
        style={{
          maxWidth: 120,
          padding: '1px 7px',
          borderRadius: 8,
          fontFamily: 'var(--tc-ui-font, inherit)',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--cpd-color-text-primary)',
          background: 'var(--cpd-color-bg-subtle-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </div>
    </div>
  )
}
