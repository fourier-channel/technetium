import { useEffect, useRef, useState } from 'react'
import type { Room } from 'matrix-js-sdk'
import { useClient } from '../client/ClientContext'
import { type TreeNode } from '../client/spaces'
import { useNavTree } from '../client/useNavTree'
import { useRoomNotifications, type NotifMap, type NotifCounts } from '../client/useRoomNotifications'
import { useRoomListSettings } from './roomListSettings'
import { useReducedMotion } from './reducedMotion'
import { AuthedImage } from './AuthedImage'
import { RoomContextMenu } from './RoomContextMenu'

// Membership/join classification for a node's visual + click behavior.
type Mode = 'joined' | 'joinable' | 'knock'
function nodeMode(node: TreeNode): Mode {
  if (node.membership === 'join') return 'joined'
  if (node.membership === 'invite') return 'joinable' // accepting = a join
  const jr = node.joinRule
  if (jr === 'knock' || jr === 'knock_restricted') return 'knock'
  // restricted / public / anything else visible-but-unjoined: a direct join.
  return 'joinable'
}

export function NavTree({
  selectedRoomId,
  onSelectRoom,
}: {
  selectedRoomId?: string
  onSelectRoom?: (room: Room) => void
}) {
  const { client } = useClient()
  const { tree, loading, stale } = useNavTree(client)
  const notifs = useRoomNotifications(client)
  const { animationsEnabled, setAnimationsEnabled } = useRoomListSettings()
  const reduced = useReducedMotion()
  const animate = animationsEnabled && !reduced
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<{ node: TreeNode; x: number; y: number } | null>(null)
  const onContext = (node: TreeNode, e: React.MouseEvent) => {
    e.preventDefault()
    setMenu({ node, x: e.clientX, y: e.clientY })
  }

  const toggle = (roomId: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(roomId)) next.delete(roomId)
      else next.add(roomId)
      return next
    })

  if (!tree) {
    return (
      <nav style={{ padding: '8px', fontSize: 13, color: 'var(--cpd-color-text-secondary)' }}>
        {loading ? 'Loading rooms...' : null}
      </nav>
    )
  }

  return (
    <nav
      style={{
        fontFamily: 'var(--tc-ui-font)',
        fontSize: 13,
        lineHeight: 1.3,
        color: 'var(--cpd-color-text-primary)',
        userSelect: 'none',
        // Stale = last-known shape, still syncing: dim + soft pulse, reconciles
        // to full opacity the instant the live tree lands (CD-11).
        opacity: stale ? 0.5 : 1,
        transition: 'opacity 400ms ease',
        animation: stale && !reduced ? 'navStalePulse 1.6s ease-in-out infinite' : undefined,
      }}
    >
      {stale && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '2px 10px 8px',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.3,
            color: 'var(--cpd-color-text-secondary)',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--cpd-color-bg-accent-rest, #3390ff)',
              animation: reduced ? undefined : 'navStaleDot 1s ease-in-out infinite',
            }}
          />
          Syncing your rooms{'…'}
        </div>
      )}
      <style>{`
        @keyframes navStalePulse { 0%,100% { opacity: 0.5; } 50% { opacity: 0.62; } }
        @keyframes navStaleDot { 0%,100% { opacity: 0.35; } 50% { opacity: 1; } }
        @keyframes navJoinRipple {
          0%   { background: var(--cpd-color-bg-action-primary-rest); }
          100% { background: transparent; }
        }
        .nav-join-ripple { animation: navJoinRipple 900ms ease-out 1; }
        /* Fourier reveal: an N-harmonic square composite is drawn left->right;
           as the sweep passes, the room name flickers in behind it. */
        @keyframes frSweep { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
        @keyframes frWaveFade { 0% { opacity: 0; } 8% { opacity: 1; } 68% { opacity: 1; } 100% { opacity: 0; } }
        @keyframes frNameWipe { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
        @keyframes frFlicker {
          0% { opacity: 0.12; } 20% { opacity: 0.85; } 32% { opacity: 0.22; }
          48% { opacity: 1; } 60% { opacity: 0.5; } 75% { opacity: 1; } 100% { opacity: 1; }
        }
        .fr { position: relative; display: inline-flex; align-items: center; min-width: 0; max-width: 100%; }
        .fr-name {
          display: inline-block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          animation: frNameWipe 780ms ease-out 470ms both, frFlicker 780ms steps(24, end) 470ms both;
        }
        .fr-wave { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; animation: frWaveFade 1250ms ease-out forwards; }
        .fr-sweep {
          fill: none; stroke: #ff9a3c; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;
          stroke-dasharray: 1; filter: drop-shadow(0 0 2px rgba(255,150,40,0.7));
          animation: frSweep 900ms ease-in-out forwards;
        }
        @keyframes roomLetterPulse {
          0%, 40%, 60%, 100% {
            color: var(--tc-unread-base);
            text-shadow: 0 0 2px rgba(255,150,40,0.30);
          }
          50% {
            color: var(--tc-unread-bright);
            text-shadow: 0 0 11px rgba(255,175,80,0.98);
          }
        }
        .room-pulse-letter { animation: roomLetterPulse 1600ms linear infinite; }
      `}</style>
      {/* Master animations toggle (seed for the future settings UI). */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '2px 10px 6px',
          fontSize: 11,
          color: 'var(--cpd-color-text-secondary)',
        }}
      >
        <span>Animations</span>
        <button
          type="button"
          onClick={() => setAnimationsEnabled(!animationsEnabled)}
          title="Toggle room-list animations (pulses, glows, collapse)"
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.3,
            padding: '2px 8px',
            borderRadius: 10,
            cursor: 'pointer',
            border: '1px solid rgba(128,128,128,0.35)',
            color: animationsEnabled ? '#1b1300' : 'var(--cpd-color-text-secondary)',
            background: animationsEnabled ? 'var(--tc-unread)' : 'transparent',
          }}
        >
          {animationsEnabled ? 'ON' : 'OFF'}
        </button>
      </div>
      {tree.spaces.map((node) => (
        <TreeRow
          key={node.roomId}
          node={node}
          depth={0}
          collapsed={collapsed}
          onToggle={toggle}
          selectedRoomId={selectedRoomId}
          onSelectRoom={onSelectRoom}
          notifs={notifs}
          animate={animate}
          onContext={onContext}
        />
      ))}
      {tree.orphanRooms.length > 0 && (
        <>
          <div
            style={{
              margin: '10px 0 2px',
              padding: '0 8px',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
              color: 'var(--cpd-color-text-secondary)',
            }}
          >
            Direct &amp; other
          </div>
          {tree.orphanRooms.map((node) => (
            <TreeRow
              key={node.roomId}
              node={node}
              depth={0}
              collapsed={collapsed}
              onToggle={toggle}
              selectedRoomId={selectedRoomId}
              onSelectRoom={onSelectRoom}
              notifs={notifs}
              animate={animate}
              onContext={onContext}
            />
          ))}
        </>
      )}
      {menu && (
        <RoomContextMenu
          node={menu.node}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}
    </nav>
  )
}

function TreeRow({
  node,
  depth,
  collapsed,
  onToggle,
  selectedRoomId,
  onSelectRoom,
  notifs,
  animate,
  onContext,
}: {
  node: TreeNode
  depth: number
  collapsed: Set<string>
  onToggle: (roomId: string) => void
  selectedRoomId?: string
  onSelectRoom?: (room: Room) => void
  notifs: NotifMap
  animate: boolean
  onContext: (node: TreeNode, e: React.MouseEvent) => void
}) {
  const { client } = useClient()
  const { isFavorite, isMutedNow } = useRoomListSettings()
  const label = node.name || node.roomId
  const isCollapsed = collapsed.has(node.roomId)
  const isSelected = !node.isSpace && node.roomId === selectedRoomId
  const indent = 6 + depth * 12
  const mode = nodeMode(node)
  const [busy, setBusy] = useState(false)
  const [knocked, setKnocked] = useState(false)
  const [actionError, setActionError] = useState(false)

  // Fire a one-shot ripple when this row transitions INTO joined.
  const prevMode = useRef(mode)
  const [ripple, setRipple] = useState(false)
  useEffect(() => {
    if (prevMode.current !== 'joined' && mode === 'joined') {
      setRipple(true)
      const t = setTimeout(() => setRipple(false), 900)
      prevMode.current = mode
      return () => clearTimeout(t)
    }
    prevMode.current = mode
  }, [mode])

  const onClick = async () => {
    if (node.isSpace && mode === 'joined') {
      onToggle(node.roomId)
      return
    }
    if (mode === 'joined') {
      if (node.room) onSelectRoom?.(node.room)
      return
    }
    if (!client || busy) return
    if (mode === 'knock') {
      setBusy(true)
      setActionError(false)
      try {
        await client.knockRoom(node.roomId)
        setKnocked(true)
      } catch {
        setActionError(true)
      } finally {
        setBusy(false)
      }
      return
    }
    // joinable: join, then open the room once it materializes.
    setBusy(true)
    setActionError(false)
    try {
      await client.joinRoom(node.roomId)
      const room = client.getRoom(node.roomId)
      if (room && !node.isSpace) onSelectRoom?.(room)
    } catch {
      setActionError(true)
    } finally {
      setBusy(false)
    }
  }

  // Color/weight per mode. Joinable = bright green; knock = darker green
  // (de-emphasized, no pill); joined = normal text.
  const color = actionError
    ? 'var(--cpd-color-text-critical-primary)'
    : mode === 'joinable'
      ? '#3bd16f'
      : mode === 'knock'
        ? '#2b9450'
        : node.isSpace
          ? 'var(--cpd-color-text-secondary)'
          : 'var(--cpd-color-text-primary)'

  const isFav = !node.isSpace && isFavorite(node.roomId)
  // Aggregate descendant unread onto a collapsed space header (excludes muted).
  const agg = node.isSpace
    ? aggregateNotif(node, notifs, isMutedNow)
    : { total: 0, highlight: 0 }
  const spaceUnread = node.isSpace && isCollapsed && agg.total > 0
  // Favorited descendant rooms stay visible when the space is collapsed.
  const favChildren = node.isSpace && isCollapsed ? collectFavoriteRooms(node, isFavorite) : []

  return (
    <>
      <div
        onClick={onClick}
        onContextMenu={(e) => onContext(node, e)}
        title={knocked ? `${label} (request sent)` : label}
        className={ripple && animate ? 'nav-join-ripple' : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          paddingLeft: indent,
          paddingRight: 6,
          height: 28,
          cursor: 'pointer',
          borderRadius: 6,
          margin: '2px 4px',
          opacity: busy ? 0.6 : 1,
          fontWeight: mode === 'joinable' ? 700 : node.isSpace ? 600 : 400,
          color,
          background: isSelected
            ? 'var(--cpd-color-bg-action-primary-rest)'
            : 'transparent',
        }}
        onMouseEnter={(e) => {
          if (!isSelected)
            e.currentTarget.style.background = 'var(--cpd-color-bg-subtle-secondary)'
        }}
        onMouseLeave={(e) => {
          if (!isSelected) e.currentTarget.style.background = 'transparent'
        }}
      >
        <span style={{ width: 10, flexShrink: 0, textAlign: 'center', fontSize: 10, opacity: 0.7 }}>
          {node.isSpace ? (isCollapsed ? '\u25B8' : '\u25BE') : ''}
        </span>
        <RoomIcon node={node} />
        {node.isSpace ? (
          <span
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: spaceUnread ? 'var(--tc-unread-base)' : undefined,
              textShadow: spaceUnread ? '0 0 6px rgba(255,150,40,0.5)' : undefined,
            }}
          >
            {label}
          </span>
        ) : (
          <FourierReveal seed={node.roomId} play={animate}>
            <RoomName label={label} counts={notifs.get(node.roomId)} roomId={node.roomId} animate={animate} />
          </FourierReveal>
        )}
        <span
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            flexShrink: 0,
            paddingLeft: 4,
          }}
        >
          {isFav && (
            <span style={{ fontSize: 11, color: 'var(--tc-unread)' }} title="Favorite">
              {'★'}
            </span>
          )}
          {spaceUnread && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                lineHeight: 1,
                padding: '2px 6px',
                borderRadius: 9,
                color: '#1b1300',
                background: 'var(--tc-unread)',
                boxShadow: '0 0 8px rgba(255,150,40,0.55)',
              }}
              title={`${agg.total} unread${agg.highlight > 0 ? `, ${agg.highlight} ping` : ''}`}
            >
              {agg.highlight > 0 ? '@' : ''}
              {agg.total}
            </span>
          )}
          {knocked && <span style={{ fontSize: 10, opacity: 0.8 }}>requested</span>}
        </span>
      </div>
      {node.isSpace && (
        // Fluid collapse via grid-template-rows 1fr <-> 0fr (animates to auto
        // height with no fixed-height measurement). Inner wrapper clips content.
        <div
          style={{
            display: 'grid',
            gridTemplateRows: isCollapsed ? '0fr' : '1fr',
            transition: animate ? 'grid-template-rows 240ms ease' : undefined,
          }}
        >
          <div style={{ overflow: 'hidden', minHeight: 0 }}>
            {node.children.map((child) => (
              <TreeRow
                key={child.roomId}
                node={child}
                depth={depth + 1}
                collapsed={collapsed}
                onToggle={onToggle}
                selectedRoomId={selectedRoomId}
                onSelectRoom={onSelectRoom}
                notifs={notifs}
                animate={animate}
                onContext={onContext}
              />
            ))}
          </div>
        </div>
      )}
      {/* Favorited descendant rooms stay pinned/visible while collapsed. */}
      {favChildren.map((fav) => (
        <TreeRow
          key={`fav:${fav.roomId}`}
          node={fav}
          depth={depth + 1}
          collapsed={collapsed}
          onToggle={onToggle}
          selectedRoomId={selectedRoomId}
          onSelectRoom={onSelectRoom}
          notifs={notifs}
          animate={animate}
          onContext={onContext}
        />
      ))}
    </>
  )
}

// Sum descendant (non-space) unread onto a space, skipping muted rooms.
function aggregateNotif(
  node: TreeNode,
  notifs: NotifMap,
  isMutedNow: (roomId: string) => boolean,
): NotifCounts {
  let total = 0
  let highlight = 0
  const walk = (n: TreeNode) => {
    if (!n.isSpace && !isMutedNow(n.roomId)) {
      const c = notifs.get(n.roomId)
      if (c) {
        total += c.total
        highlight += c.highlight
      }
    }
    for (const ch of n.children) walk(ch)
  }
  for (const ch of node.children) walk(ch)
  return { total, highlight }
}

// Gather favorited (non-space) rooms anywhere under a space, flattened.
function collectFavoriteRooms(node: TreeNode, isFavorite: (roomId: string) => boolean): TreeNode[] {
  const out: TreeNode[] = []
  const walk = (n: TreeNode) => {
    if (!n.isSpace && isFavorite(n.roomId)) out.push(n)
    for (const ch of n.children) walk(ch)
  }
  for (const ch of node.children) walk(ch)
  return out
}

// Room name with unread treatment. Muted rooms render plain. Unread (total > 0)
// gets an orange glow + a "(N)" count. A ping (highlight > 0) additionally shows
// an orange "@" and, when animations are enabled, a pulse that travels through
// the name letter by letter. When animations are off / reduced-motion, the ping
// Fourier reveal wrapper (Ask 2026-07-19, tuned): on a room's first appearance a
// square-wave PARTIAL SUM of N harmonics (N random-ish per room, 2..5 -> a
// different composite each time) is drawn left->right in Fourier-chan amber; as
// the sweep passes, the room name flickers in behind it (landing-page style).
// Plays once on mount; play=false (animations off / reduced motion) = plain name.

// Square-wave partial sum f_N(t) = (4/pi) sum_{k<N} sin((2k+1)t)/(2k+1), sampled
// across a 120x24 box (2 cycles). pathLength=1 so the draw is length-agnostic.
function squarePartialPath(harmonics: number): string {
  const W = 120, H = 24, mid = H / 2, amp = 7, samples = 72, cycles = 2
  const pts: string[] = []
  for (let i = 0; i <= samples; i++) {
    const x = (i / samples) * W
    const t = (i / samples) * Math.PI * 2 * cycles
    let y = 0
    for (let k = 0; k < harmonics; k++) {
      const n = 2 * k + 1
      y += Math.sin(n * t) / n
    }
    y = mid - amp * (4 / Math.PI) * y
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  return 'M' + pts.join(' L')
}
// One composite per harmonic count (2..5) -- squarer with more harmonics.
const FR_COMPOSITES: Record<number, string> = {
  2: squarePartialPath(2),
  3: squarePartialPath(3),
  4: squarePartialPath(4),
  5: squarePartialPath(5),
}
function frHash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function FourierReveal({ children, seed, play }: { children: React.ReactNode; seed: string; play: boolean }) {
  if (!play) return <>{children}</>
  const harmonics = 2 + (frHash(seed) % 4) // 2..5, stable per room
  return (
    <span className="fr">
      <span className="fr-name">{children}</span>
      <svg className="fr-wave" viewBox="0 0 120 24" preserveAspectRatio="none" aria-hidden="true">
        <path className="fr-sweep" pathLength={1} d={FR_COMPOSITES[harmonics]} />
      </svg>
    </span>
  )
}

// shows the static @ + glow with no travelling pulse.
function RoomName({
  label,
  counts,
  roomId,
  animate,
}: {
  label: string
  counts: NotifCounts | undefined
  roomId: string
  animate: boolean
}) {
  const { isMutedNow } = useRoomListSettings()
  const muted = isMutedNow(roomId)
  const total = muted ? 0 : (counts?.total ?? 0)
  const highlight = muted ? 0 : (counts?.highlight ?? 0)
  const unread = total > 0
  const ping = highlight > 0

  const ell = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const

  if (!unread && !ping) {
    return <span style={ell}>{label}</span>
  }

  const glow: React.CSSProperties = {
    color: 'var(--tc-unread-base)',
    textShadow: '0 0 6px rgba(255,150,40,0.55)',
    fontWeight: 600,
  }
  const at = ping ? (
    <span style={{ color: 'var(--tc-unread)', fontWeight: 700, marginRight: 2 }}>@</span>
  ) : null
  const count = <span style={{ opacity: 0.85, marginLeft: 4 }}>({total})</span>

  if (ping && animate) {
    // Letter-by-letter traveling pulse: each glyph shares one keyframe, staggered
    // by its index so a bright band walks across the name at a moderate pace.
    const chars = [...label]
    return (
      <span style={{ ...ell, fontWeight: 600 }}>
        {at}
        {chars.map((ch, i) => (
          <span
            key={i}
            className="room-pulse-letter"
            style={{ animationDelay: `${i * 90}ms` }}
          >
            {ch === ' ' ? ' ' : ch}
          </span>
        ))}
        {count}
      </span>
    )
  }

  return (
    <span style={{ ...ell, ...glow }}>
      {at}
      {label}
      {count}
    </span>
  )
}

// Icon to the left of a room/space name: a user-set emoji/glyph override
// (right-click -> Set icon), else the room/space avatar, else a generated
// initial. Spaces get a rounded-square frame, rooms a circle.
function RoomIcon({ node, size = 20 }: { node: TreeNode; size?: number }) {
  const { getIcon } = useRoomListSettings()
  const override = getIcon(node.roomId)
  const avatarMxc = node.room?.getMxcAvatarUrl() ?? null

  const frame: React.CSSProperties = {
    width: size,
    height: size,
    flexShrink: 0,
    borderRadius: node.isSpace ? 6 : '50%',
    overflow: 'hidden',
    display: 'grid',
    placeItems: 'center',
    fontSize: Math.round(size * 0.62),
    lineHeight: 1,
    background: 'var(--cpd-color-bg-subtle-primary)',
    color: 'var(--cpd-color-text-secondary)',
  }

  const initial =
    (node.name || node.roomId).replace(/^[#!@]/, '').charAt(0).toUpperCase() || '#'

  if (override)
    return (
      <span style={frame} aria-hidden>
        {override}
      </span>
    )
  if (avatarMxc)
    return (
      <span style={frame} aria-hidden>
        {/* Avatars come from the homeserver's authenticated media (the fourier-auth
            content gate 403s them); degrade to the initial if even that fails. */}
        <AuthedImage mxc={avatarMxc} width={180} fill transparentLoading alt="" fallback={initial} viaHomeserver />
      </span>
    )
  return (
    <span style={frame} aria-hidden>
      {initial}
    </span>
  )
}
