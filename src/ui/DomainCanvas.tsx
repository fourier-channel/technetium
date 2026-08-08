import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { MatrixClient, Room } from 'matrix-js-sdk'
import { useDomainPositions, type DomainPos } from '../client/useDomainPositions'
import { useDomainBubbles, type Bubble } from '../client/useDomainBubbles'
import { useDomainBackground } from '../client/useDomainBackground'
import { useDomainMedia, type DomainMediaObject } from '../client/useDomainMedia'
import { useDomainObjects, type DomainObject, type MovePerm } from '../client/useDomainObjects'
import { useDomainActions, ACTION_REGISTRY, type ActiveAction } from '../client/useDomainActions'
import { useDomainModeration } from '../client/useDomainModeration'
import type { DomainSettingsApi } from './domainSettings'
import { AuthedImage } from './AuthedImage'
import { MediaTags } from './MediaTags'
import { DomainBackgroundEditor } from './DomainBackgroundEditor'
import { DomainTtdControl } from './DomainTtdControl'
import { DomainUserMenu } from './DomainUserMenu'
import { ProfileCard } from './ProfileCard'
import { isDomainAdmin } from './domainRoles'
import { useLightbox } from './Lightbox'
import { transformToStyle, type Transform } from './uitransform/transform'

const PRESET_AVATARS = ['😀', '😎', '🤖', '👾', '🐱', '🦊', '🐸', '👻', '🎧', '🕹️', '🌟', '🔥']

// ---------------------------------------------------------------------------
// Domain canvas: a grid "room" where each participant is an avatar puck at a
// normalized position. Click anywhere to move yourself there; your puck (and,
// when their events arrive, others') travels smoothly to the spot.
//
// Positions come from useDomainPositions (timeline-event transport). Bubbles,
// backdrop, and the avatar-change menu layer on in later steps.
// ---------------------------------------------------------------------------

const AVATAR_SIZE = 44
const CARD_SIZE = 92

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

export function DomainCanvas({
  client,
  room,
  settings,
  bgEditing = false,
  onExitBgEdit,
  ttd,
  onTtdChange,
}: {
  client: MatrixClient
  room: Room
  settings: DomainSettingsApi
  bgEditing?: boolean
  onExitBgEdit?: () => void
  ttd: number
  onTtdChange: (n: number) => void
}) {
  const { positions, myUserId, setMyPosition } = useDomainPositions(client, room)
  const bubbles = useDomainBubbles(client, room)
  const { background } = useDomainBackground(client, room)
  const media = useDomainMedia(client, room)
  const objects = useDomainObjects(client, room)
  const actions = useDomainActions(client, room)
  const { collapsed, forceCollapse } = useDomainModeration(client, room)
  const { open: openLightbox } = useLightbox()
  const isAdmin = isDomainAdmin(client, room)
  const ref = useRef<HTMLDivElement>(null)
  const [avatarMenu, setAvatarMenu] = useState<{ x: number; y: number } | null>(null)
  const [userMenu, setUserMenu] = useState<{ x: number; y: number; userId: string } | null>(null)
  const [profile, setProfile] = useState<{ x: number; y: number; userId: string } | null>(null)
  // Right-click menus for canvas media (detach) and detached objects (perm/remove).
  const [mediaMenu, setMediaMenu] = useState<{ x: number; y: number; obj: DomainMediaObject; px: number; py: number } | null>(null)
  const [objectMenu, setObjectMenu] = useState<{ x: number; y: number; obj: DomainObject } | null>(null)
  // A puck is hidden when an admin force-collapse is at least as new as the
  // user's latest position (they reappear by re-placing -> newer position ts).
  const isHidden = (userId: string, ts: number) => {
    const c = collapsed.get(userId)
    return c !== undefined && c >= ts
  }
  const visible = [...positions.entries()].filter(([uid, pos]) => !isHidden(uid, pos.ts))
  const placedSelf = myUserId != null && positions.has(myUserId)
  const backdrop = settings.getBackdrop(room.roomId)
  // The shared domain background (room state) takes precedence over the legacy
  // local backdrop URL. Both are hidden while editing (so the editor's own
  // preview is what you move) and behind the user's show-backgrounds pref.
  const showSharedBg = background && settings.showBackgrounds && !bgEditing
  const showLegacyBackdrop = !background && backdrop && settings.showBackgrounds && !bgEditing

  const onClick = (e: React.MouseEvent) => {
    if (bgEditing) return // background editor owns input while active
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setMyPosition((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
  }

  // Right-click another user's puck -> user menu. Hit-tested at the canvas level
  // (pucks are pointer-transparent so placement still works); the self puck's
  // own handler catches self right-clicks first.
  const onContextMenu = (e: React.MouseEvent) => {
    if (bgEditing) return
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const cx = e.clientX - r.left
    const cy = e.clientY - r.top
    for (const [uid, pos] of visible) {
      if (uid === myUserId) continue
      const dx = pos.x * r.width - cx
      const dy = pos.y * r.height - cy
      if (Math.hypot(dx, dy) <= AVATAR_SIZE * 0.75) {
        e.preventDefault()
        setUserMenu({ x: e.clientX, y: e.clientY, userId: uid })
        return
      }
    }
  }

  return (
    <div
      ref={ref}
      onClick={onClick}
      onContextMenu={onContextMenu}
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        cursor: 'pointer',
        backgroundColor: 'var(--cpd-color-bg-canvas-default)',
      }}
    >
      <style>{`
        @keyframes domainBubbleIn {
          from { opacity: 0; transform: translate(-50%, 4px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
        @keyframes domainCardIn {
          from { opacity: 0; transform: scale(0.4); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes domainActionPop {
          0%   { transform: scale(0);   opacity: 0; }
          14%  { transform: scale(1);   opacity: 1; }
          68%  { transform: scale(1);   opacity: 1; }
          100% { transform: scale(0);   opacity: 0; }
        }
        @keyframes domainActionFade {
          0%   { opacity: 0; }
          15%  { opacity: 1; }
          70%  { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
      {/* Shared domain background (room state) + its transform, beneath the
          grid. Hidden while editing and behind the show-backgrounds pref. */}
      {showSharedBg && background && (
        <DomainBackgroundLayer mxc={background.mxc} transform={background.transform} />
      )}
      {/* Legacy local backdrop URL, only when no shared background is set. */}
      {showLegacyBackdrop && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 0,
            pointerEvents: 'none',
            backgroundImage: `url("${backdrop}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      )}
      {/* Techy grid overlay (two layers of thin lines). */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          pointerEvents: 'none',
          backgroundImage:
            'linear-gradient(rgba(128,128,128,0.16) 1px, transparent 1px),' +
            'linear-gradient(90deg, rgba(128,128,128,0.16) 1px, transparent 1px)',
          backgroundSize: '32px 32px, 32px 32px',
        }}
      />
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
      {visible.map(([userId, pos]) => (
        <DomainAvatar
          key={userId}
          room={room}
          userId={userId}
          pos={pos}
          isSelf={userId === myUserId}
          bubble={bubbles.get(userId)}
          override={settings.getAvatar(userId)}
          onSelfContext={
            userId === myUserId
              ? (e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setAvatarMenu({ x: e.clientX, y: e.clientY })
                }
              : undefined
          }
        />
      ))}
      {/* Media-objects: cards spawned from each sender's puck, live for their
          ttd, click == open the image like inline. Multiple from one sender
          cascade so they don't stack. */}
      {(() => {
        const nth = new Map<string, number>()
        return media.map((obj) => {
          const i = nth.get(obj.sender) ?? 0
          nth.set(obj.sender, i + 1)
          const pos = positions.get(obj.sender) ?? { x: 0.5, y: 0.5 }
          return (
            <DomainMediaCard
              key={obj.id}
              obj={obj}
              x={pos.x}
              y={pos.y}
              index={i}
              roomId={room.roomId}
              onOpen={() => openLightbox([{ mxc: obj.mxc, name: obj.name, mimetype: obj.mimetype }], 0)}
              onContext={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setMediaMenu({ x: e.clientX, y: e.clientY, obj, px: pos.x, py: pos.y })
              }}
            />
          )
        })
      })()}

      {/* Detached canvas objects: images left on the canvas, draggable by whoever
          is permitted. Rendered above the grid; right-click for perm/remove. */}
      {objects.objects.map((obj) => (
        <DomainObjectCard
          key={obj.id}
          obj={obj}
          containerRef={ref}
          canMove={objects.canMove(obj)}
          roomId={room.roomId}
          onMove={(x, y) => objects.move(obj.id, x, y)}
          onOpen={() => openLightbox([{ mxc: obj.mxc, name: obj.name, mimetype: obj.mimetype }], 0)}
          onContext={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setObjectMenu({ x: e.clientX, y: e.clientY, obj })
          }}
        />
      ))}

      {/* Ephemeral avatar actions: self effects anchored to a puck; thrown items
          arc from sender to target. Scaffolding + POC (square / throw). */}
      {actions.actions.map((a) => {
        const from = positions.get(a.sender)
        if (!from) return null
        if (a.def.kind === 'throw') {
          const to = a.target ? positions.get(a.target) : undefined
          if (!to) return null
          return <ThrownProjectile key={a.key} action={a} from={{ x: from.x, y: from.y }} to={{ x: to.x, y: to.y }} />
        }
        return <SelfActionEffect key={a.key} action={a} pos={{ x: from.x, y: from.y }} />
      })}

      {/* TTD control (top-left), hidden during background editing. */}
      {!bgEditing && (
        <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 40 }} onClick={(e) => e.stopPropagation()}>
          <DomainTtdControl ttd={ttd} onChange={onTtdChange} />
        </div>
      )}

      {bgEditing && (
        <DomainBackgroundEditor client={client} room={room} onExit={() => onExitBgEdit?.()} />
      )}
      {mediaMenu && (
        <CanvasMenu
          x={mediaMenu.x}
          y={mediaMenu.y}
          onClose={() => setMediaMenu(null)}
          items={[
            {
              label: 'Open image',
              onClick: () => {
                openLightbox([{ mxc: mediaMenu.obj.mxc, name: mediaMenu.obj.name, mimetype: mediaMenu.obj.mimetype }], 0)
                setMediaMenu(null)
              },
            },
            ...(mediaMenu.obj.sender === myUserId || isAdmin
              ? [
                  {
                    label: 'Detach to canvas',
                    onClick: () => {
                      objects.create({
                        mxc: mediaMenu.obj.mxc,
                        x: Math.min(1, mediaMenu.px + 0.05),
                        y: mediaMenu.py,
                        name: mediaMenu.obj.name,
                        mimetype: mediaMenu.obj.mimetype,
                      })
                      setMediaMenu(null)
                    },
                  },
                ]
              : []),
          ]}
        />
      )}
      {objectMenu &&
        (() => {
          const o = objectMenu.obj
          const admin = objects.isOwnerOrAdmin(o)
          const items: CanvasMenuItem[] = [
            {
              label: 'Open image',
              onClick: () => {
                openLightbox([{ mxc: o.mxc, name: o.name, mimetype: o.mimetype }], 0)
                setObjectMenu(null)
              },
            },
          ]
          if (admin) {
            const permItem = (perm: MovePerm, label: string): CanvasMenuItem => ({
              label: (o.perm === perm ? '• ' : '  ') + label,
              onClick: () => {
                objects.setPerm(o.id, perm, perm === 'whitelist' ? o.allow : undefined)
                setObjectMenu(null)
              },
            })
            items.push({ label: 'Who can move:', header: true, onClick: () => {} })
            items.push(permItem('everyone', 'Anyone'))
            items.push(permItem('owner', 'Only me'))
            items.push(permItem('mods', 'Mods & me'))
            items.push(permItem('whitelist', 'Whitelist (edit TBD)'))
            items.push({
              label: 'Remove from canvas',
              danger: true,
              onClick: () => {
                objects.remove(o.id)
                setObjectMenu(null)
              },
            })
          }
          return <CanvasMenu x={objectMenu.x} y={objectMenu.y} onClose={() => setObjectMenu(null)} items={items} />
        })()}
      {userMenu && (
        <DomainUserMenu
          x={userMenu.x}
          y={userMenu.y}
          userId={userMenu.userId}
          room={room}
          isAdmin={isAdmin}
          onInspect={() => {
            setProfile({ x: userMenu.x, y: userMenu.y, userId: userMenu.userId })
            setUserMenu(null)
          }}
          onForceCollapse={() => {
            forceCollapse(userMenu.userId)
            setUserMenu(null)
          }}
          onThrow={() => {
            actions.trigger('throw', userMenu.userId)
            setUserMenu(null)
          }}
          onClose={() => setUserMenu(null)}
        />
      )}
      {profile && (
        <ProfileCard
          x={profile.x}
          y={profile.y}
          userId={profile.userId}
          room={room}
          onClose={() => setProfile(null)}
        />
      )}
      {avatarMenu && myUserId && (
        <AvatarMenu
          x={avatarMenu.x}
          y={avatarMenu.y}
          current={settings.getAvatar(myUserId)}
          onPick={(emoji) => {
            settings.setAvatar(myUserId, emoji)
            setAvatarMenu(null)
          }}
          onClear={() => {
            settings.clearAvatar(myUserId)
            setAvatarMenu(null)
          }}
          onAction={(action) => {
            actions.trigger(action)
            setAvatarMenu(null)
          }}
          onClose={() => setAvatarMenu(null)}
        />
      )}
    </div>
  )
}

// Small popover to set your own domain avatar (an emoji). Local override only.
function AvatarMenu({
  x,
  y,
  current,
  onPick,
  onClear,
  onClose,
  onAction,
}: {
  x: number
  y: number
  current: string | undefined
  onPick: (emoji: string) => void
  onClear: () => void
  onClose: () => void
  onAction: (action: string) => void
}) {
  const selfActions = Object.entries(ACTION_REGISTRY).filter(([, d]) => d.kind === 'self')
  const [draft, setDraft] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const left = Math.max(6, Math.min(x, window.innerWidth - 220))
  const top = Math.max(6, Math.min(y, window.innerHeight - 160))

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
  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left,
        top,
        width: 208,
        zIndex: 1000,
        padding: 8,
        borderRadius: 8,
        fontFamily: 'var(--tc-ui-font, inherit)',
        color: 'var(--cpd-color-text-primary)',
        background: 'var(--cpd-color-bg-canvas-default)',
        border: '1px solid rgba(128,128,128,0.35)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--cpd-color-text-secondary)', marginBottom: 6 }}>
        Your avatar
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 6 }}>
        {PRESET_AVATARS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onPick(emoji)}
            style={{
              width: 26,
              height: 26,
              fontSize: 16,
              display: 'grid',
              placeItems: 'center',
              background: 'transparent',
              border: '1px solid transparent',
              borderRadius: 5,
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cpd-color-bg-subtle-secondary)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            {emoji}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) onPick(draft.trim())
          }}
          placeholder="Custom emoji…"
          maxLength={4}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            padding: '3px 6px',
            color: 'var(--cpd-color-text-primary)',
            background: 'transparent',
            border: '1px solid rgba(128,128,128,0.35)',
            borderRadius: 5,
          }}
        />
        {current !== undefined && (
          <button
            type="button"
            onClick={onClear}
            style={{
              fontSize: 12,
              padding: '3px 8px',
              borderRadius: 5,
              border: '1px solid rgba(128,128,128,0.35)',
              background: 'transparent',
              color: 'var(--cpd-color-text-primary)',
              cursor: 'pointer',
            }}
          >
            Reset
          </button>
        )}
      </div>

      {selfActions.length > 0 && (
        <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid rgba(128,128,128,0.2)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--cpd-color-text-secondary)', marginBottom: 4 }}>
            Actions
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {selfActions.map(([key, def]) => (
              <button
                key={key}
                type="button"
                onClick={() => onAction(key)}
                style={{
                  fontSize: 12,
                  padding: '3px 8px',
                  borderRadius: 6,
                  border: '1px solid rgba(128,128,128,0.35)',
                  background: 'var(--cpd-color-bg-subtle-secondary)',
                  color: 'var(--cpd-color-text-primary)',
                  cursor: 'pointer',
                }}
              >
                {def.glyph} {def.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DomainAvatar({
  room,
  userId,
  pos,
  isSelf,
  bubble,
  override,
  onSelfContext,
}: {
  room: Room
  userId: string
  pos: DomainPos
  isSelf: boolean
  bubble?: Bubble
  override?: string
  onSelfContext?: (e: React.MouseEvent) => void
}) {
  const member = room.getMember(userId)
  const name = member?.name || userId
  const avatarMxc = member?.getMxcAvatarUrl() ?? null
  const travel = reduceMotion() ? undefined : 'left 380ms cubic-bezier(0.2,0.8,0.2,1), top 380ms cubic-bezier(0.2,0.8,0.2,1)'

  // Absent = the user collapsed the domain; we still show WHERE they were, but
  // desaturated and dimmed ("was here, not here now"). The spot is saved.
  const absent = pos.present === false
  const puck: CSSProperties = {
    position: 'absolute',
    left: `${pos.x * 100}%`,
    top: `${pos.y * 100}%`,
    transform: 'translate(-50%, -50%)',
    transition: travel,
    zIndex: 2,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 3,
    pointerEvents: 'none',
    filter: absent ? 'grayscale(1)' : undefined,
    opacity: absent ? 0.45 : 1,
  }

  const disc: CSSProperties = {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: '50%',
    overflow: 'hidden',
    display: 'grid',
    placeItems: 'center',
    fontSize: override ? 24 : 15,
    fontWeight: 700,
    color: '#fff',
    background: override ? 'var(--cpd-color-bg-subtle-primary)' : colorFor(userId),
    // The self disc is interactive (right-click to change avatar); others pass
    // clicks through so canvas placement still works.
    pointerEvents: isSelf ? 'auto' : 'none',
    cursor: isSelf ? 'context-menu' : 'default',
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
            animation: 'domainBubbleIn 200ms ease-out',
          }}
        >
          {bubble.text}
        </div>
      )}
      <div style={disc} onContextMenu={onSelfContext} title={isSelf ? 'Right-click to change your avatar' : undefined}>
        {override ? (
          <span>{override}</span>
        ) : avatarMxc ? (
          // Avatars come from homeserver authenticated media (the content gate
          // 403s them); degrade to initials if even that fails.
          <AuthedImage mxc={avatarMxc} width={180} fill transparentLoading alt="" fallback={initialsFor(name)} viaHomeserver />
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

// Resolve a shared-background mxc to full-res bytes (homeserver auth path, NOT
// the fourier-auth gate) and render it beneath the grid with its stored
// transform. Self-contained so DomainCanvas need not know about media auth.
function DomainBackgroundLayer({
  mxc,
  transform,
}: {
  mxc: string
  transform: Transform
}) {
  // Rendered through AuthedImage -- the SAME component every timeline image
  // uses. Backgrounds previously had their own media path, and that divergence
  // was the bug: a working feature and a broken one resolving the same kind of
  // mxc by different means. AuthedImage brings its own retry/backoff, so the
  // self-healing the old hook provided is not lost.
  return (
    <div
      style={{ ...transformToStyle(transform), zIndex: 0, pointerEvents: 'none', userSelect: 'none' }}
    >
      <AuthedImage mxc={mxc} width={850} fill transparentLoading alt="" />
    </div>
  )
}

// A media-object card: a thumbnail spawned near its sender's puck, live for its
// ttd. Clicking opens the image in the shared lightbox, same as inline. Outer
// div positions + cascades (index); inner div plays the spawn pop.
function DomainMediaCard({
  obj,
  x,
  y,
  index,
  roomId,
  onOpen,
  onContext,
}: {
  obj: DomainMediaObject
  x: number
  y: number
  index: number
  roomId: string
  onOpen: () => void
  onContext: (e: React.MouseEvent) => void
}) {
  const off = 26 + index * 16
  const rm = reduceMotion()
  return (
    <div
      style={{
        position: 'absolute',
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        transform: `translate(${AVATAR_SIZE / 2 + off}px, ${-CARD_SIZE / 2 + off * 0.4}px)`,
        zIndex: 3,
        pointerEvents: 'none',
      }}
    >
      <div
        onClick={(e) => {
          e.stopPropagation()
          onOpen()
        }}
        onContextMenu={onContext}
        title={obj.name}
        style={{
          width: CARD_SIZE,
          height: CARD_SIZE,
          borderRadius: 10,
          overflow: 'hidden',
          border: '2px solid var(--cpd-color-bg-canvas-default)',
          boxShadow: '0 6px 16px rgba(0,0,0,0.45)',
          cursor: 'pointer',
          pointerEvents: 'auto',
          background: 'var(--cpd-color-bg-subtle-secondary)',
          transformOrigin: 'top left',
          animation: rm ? undefined : 'domainCardIn 260ms cubic-bezier(0.2,0.8,0.2,1)',
        }}
      >
        <AuthedImage mxc={obj.mxc} width={180} fill alt={obj.name ?? ''} />
      </div>
      {/* Outside the clipping card: the expanded tag list floats above it and
          would be cut off by the card's own overflow: hidden. */}
      <MediaTags mxc={obj.mxc} roomId={roomId} variant="chip" max={8} />
    </div>
  )
}

// A detached canvas object: a persistent image left on the canvas. Draggable by
// permitted users (hand-rolled pointer drag; capture only past the 5px threshold
// so a plain click still opens the lightbox, G-bf01). Right-click -> perm/remove
// menu (owner/admin). Others' moves arrive via timeline and travel smoothly.
function DomainObjectCard({
  obj,
  containerRef,
  canMove,
  roomId,
  onMove,
  onOpen,
  onContext,
}: {
  obj: DomainObject
  containerRef: React.RefObject<HTMLDivElement | null>
  canMove: boolean
  roomId: string
  onMove: (x: number, y: number) => void
  onOpen: () => void
  onContext: (e: React.MouseEvent) => void
}) {
  const rm = reduceMotion()
  const dragRef = useRef<{ startX: number; startY: number; moved: boolean; pointerId: number } | null>(null)
  const movedRef = useRef(false)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !canMove) return
    e.stopPropagation()
    dragRef.current = { startX: e.clientX, startY: e.clientY, moved: false, pointerId: e.pointerId }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 5) return
      d.moved = true
      // Capture only once a real drag engages (capture-on-down suppresses click).
      try {
        e.currentTarget.setPointerCapture(d.pointerId)
      } catch {
        // ignore: capture can fail if the pointer already released
      }
    }
    const el = containerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    onMove(
      Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    )
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (d) {
      movedRef.current = d.moved
      if (e.currentTarget.hasPointerCapture(d.pointerId)) e.currentTarget.releasePointerCapture(d.pointerId)
    }
    dragRef.current = null
  }
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (movedRef.current) {
      movedRef.current = false
      return // was a drag, not a click
    }
    onOpen()
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={onClick}
      onContextMenu={onContext}
      title={canMove ? 'Drag to move · right-click for options' : obj.name ?? ''}
      style={{
        position: 'absolute',
        left: `${obj.x * 100}%`,
        top: `${obj.y * 100}%`,
        transform: 'translate(-50%, -50%)',
        transition: rm ? undefined : 'left 140ms ease-out, top 140ms ease-out',
        width: CARD_SIZE,
        height: CARD_SIZE,
        zIndex: 4,
        cursor: canMove ? 'grab' : 'pointer',
        pointerEvents: 'auto',
        touchAction: 'none',
      }}
    >
      {/* Clipping lives on an inner layer so the tag strip, which floats above
          the card, is not cut off by the rounded overflow. */}
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 10,
          overflow: 'hidden',
          border: '2px solid var(--cpd-color-bg-canvas-default)',
          boxShadow: '0 6px 16px rgba(0,0,0,0.5)',
          background: 'var(--cpd-color-bg-subtle-secondary)',
          boxSizing: 'border-box',
        }}
      >
        <AuthedImage mxc={obj.mxc} width={180} fill alt={obj.name ?? ''} />
      </div>
      <MediaTags mxc={obj.mxc} roomId={roomId} variant="chip" max={8} />
    </div>
  )
}

// A self-anchored action effect: the glyph pops in next to the sender's puck
// and shrinks away over the action's duration. POC = 'square' (a black-square
// glyph). Reduced motion -> a fade instead of a scale pop.
function SelfActionEffect({ action, pos }: { action: ActiveAction; pos: { x: number; y: number } }) {
  const rm = reduceMotion()
  return (
    <div
      style={{
        position: 'absolute',
        left: `${pos.x * 100}%`,
        top: `${pos.y * 100}%`,
        transform: 'translate(calc(-50% + 46px), -50%)',
        zIndex: 5,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          fontSize: 30,
          lineHeight: 1,
          filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.5))',
          animation: `${rm ? 'domainActionFade' : 'domainActionPop'} ${action.def.durationMs}ms ease-in-out both`,
        }}
      >
        {action.def.glyph}
      </div>
    </div>
  )
}

// A thrown item: the glyph flies from the sender's puck to the target's along a
// quadratic-bezier ARC (control point lifted up), spinning as it goes -- the
// seed of the "target another user with an image" goal. Driven by rAF writing
// left/top/transform directly (no per-frame re-render). Reduced motion -> it
// just appears at the target.
function ThrownProjectile({
  action,
  from,
  to,
}: {
  action: ActiveAction
  from: { x: number; y: number }
  to: { x: number; y: number }
}) {
  const elRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = elRef.current
    if (!el) return
    if (reduceMotion()) {
      el.style.left = `${to.x * 100}%`
      el.style.top = `${to.y * 100}%`
      return
    }
    const dur = action.def.durationMs
    const start = performance.now()
    const cx = (from.x + to.x) / 2
    const cy = Math.max(0, Math.min(from.y, to.y) - 0.22) // control point lifted up = the arc
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur)
      const mt = 1 - t
      const x = mt * mt * from.x + 2 * mt * t * cx + t * t * to.x
      const y = mt * mt * from.y + 2 * mt * t * cy + t * t * to.y
      el.style.left = `${x * 100}%`
      el.style.top = `${y * 100}%`
      el.style.transform = `translate(-50%, -50%) rotate(${t * 540}deg) scale(${1 + 0.3 * Math.sin(t * Math.PI)})`
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [action.def.durationMs, from.x, from.y, to.x, to.y])

  return (
    <div
      ref={elRef}
      style={{
        position: 'absolute',
        left: `${from.x * 100}%`,
        top: `${from.y * 100}%`,
        transform: 'translate(-50%, -50%)',
        zIndex: 6,
        pointerEvents: 'none',
        fontSize: 34,
        lineHeight: 1,
        filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.6))',
      }}
    >
      {action.def.glyph}
    </div>
  )
}

export interface CanvasMenuItem {
  label: string
  onClick: () => void
  danger?: boolean
  header?: boolean
}

// A small fixed-position popover menu (shared by the media-detach and object
// perm/remove menus). Closes on outside-click / Escape.
function CanvasMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: CanvasMenuItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const left = Math.max(6, Math.min(x, window.innerWidth - 210))
  const top = Math.max(6, Math.min(y, window.innerHeight - (items.length * 30 + 16)))

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

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left,
        top,
        width: 200,
        zIndex: 1000,
        padding: 4,
        borderRadius: 8,
        fontFamily: 'var(--tc-ui-font, inherit)',
        color: 'var(--cpd-color-text-primary)',
        background: 'var(--cpd-color-bg-canvas-default)',
        border: '1px solid rgba(128,128,128,0.35)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
      }}
    >
      {items.map((it, i) =>
        it.header ? (
          <div
            key={i}
            style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--cpd-color-text-secondary)', padding: '6px 8px 2px' }}
          >
            {it.label}
          </div>
        ) : (
          <button
            key={i}
            type="button"
            onClick={it.onClick}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              fontSize: 13,
              padding: '6px 8px',
              borderRadius: 6,
              border: 'none',
              background: 'transparent',
              color: it.danger ? 'var(--cpd-color-text-critical-primary, #ff6b6b)' : 'var(--cpd-color-text-primary)',
              cursor: 'pointer',
              whiteSpace: 'pre',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cpd-color-bg-subtle-secondary)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            {it.label}
          </button>
        ),
      )}
    </div>
  )
}
