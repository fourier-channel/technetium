import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Room } from 'matrix-js-sdk'
import { useClient } from '../client/clientContextValue'
import { computeRevealOrder, type TreeNode } from '../client/spaces'
import type { NavTree as NavTreeShape } from '../client/spaces'
import type { NotifMap, NotifCounts } from '../client/useRoomNotifications'
import { useNavShared } from './navShared'
import { useRoomListSettings } from './roomListSettings'
import { UserPicker } from './UserPicker'
import { describeInviteError } from '../client/userDirectory'
import { useFlipList, type FlipControl } from './flip'
import { useThreadDrag } from './threadDrag'
import { arrangeSiblings, roomOrderScope } from './roomOrder'
import { useReducedMotion } from './reducedMotion'
import { EpicycleReveal, RoomIcon } from './RoomIcon'
import { frHash } from './frHash'
import { RoomContextMenu } from './RoomContextMenu'
import { reportAlways } from '../client/report'
import { adoptDm, pendingDmInviter } from '../client/dm'
import { configureRoomEncryptionNow } from '../client/roomEncryptionConfig'

// Room-list row metrics. Vertical pitch = ROW_HEIGHT + 2 * ROW_MARGIN_Y.
// Tightened 2026-08-13 (32px -> 28px) to fit more of the tree on screen.
const ROW_HEIGHT = 26
const ROW_MARGIN_Y = 1
/** A row's own left padding at the top level. */
const NAV_PAD_X = 4
/** A space's chevron, and the row gap after it (the row's flex gap, 6). */
const NAV_CHEVRON_W = 10
const NAV_CHEVRON_SLOT = NAV_CHEVRON_W + 6

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

// Text width via a shared offscreen canvas (no DOM thrash).
let measureCanvas: HTMLCanvasElement | null = null
function measureText(text: string, font: string): number {
  if (!measureCanvas) measureCanvas = document.createElement('canvas')
  const ctx = measureCanvas.getContext('2d')
  if (!ctx) return text.length * 7
  ctx.font = font
  return ctx.measureText(text).width
}
// Default panel width: fit the WIDEST room name -- unless it's more than 1.5x the
// second-widest (an outlier), in which case fall back to the second-widest.
// Only names this list DRAWS: the conversations outside every space are the
// user list's now (L30), and were only ever drawn here as faces anyway.
function computeDefaultPanelWidth(tree: NavTreeShape | null): number {
  if (!tree) return 260
  const names: string[] = []
  const walk = (nodes: TreeNode[]) => nodes.forEach((n) => { names.push(n.name); walk(n.children) })
  walk(tree.spaces)
  const font = '600 13px "Space Grotesk", system-ui, sans-serif'
  const widths = names.map((n) => measureText(n, font)).sort((a, b) => b - a)
  if (widths.length === 0) return 260
  const widest = widths[0]
  const second = widths[1] ?? widest
  const chosen = widest <= 1.5 * second ? widest : second
  // icon + chevron + indent + padding + count badge. 86, from 100: L14 took
  // the empty chevron slot off every room row and 2px off the first indent.
  const BASE = 86
  return Math.round(Math.max(200, Math.min(460, BASE + chosen)))
}

export function NavTree({
  selectedRoomId,
  onSelectRoom,
  onDefaultWidth,
  booruActive = false,
  onSelectBooru,
}: {
  selectedRoomId?: string
  onSelectRoom?: (room: Room) => void
  onDefaultWidth?: (w: number) => void
  // The booru row: presented on the space's tier (operator, 2026-09-06) so
  // the experience is toggling between the booru and the chat. Active when
  // no room is selected, which is when the main pane shows the booru.
  booruActive?: boolean
  onSelectBooru?: () => void
}) {
  const { client } = useClient()
  // The tree and the counts are held once, by App, and shared with the user
  // list's Direct Messages section (navShared.ts, L30).
  const { nav: { tree, loading, stale }, notifs } = useNavShared()
  const { animationsEnabled, setAnimationsEnabled, soundEnabled, setSoundEnabled, soundVolume, setSoundVolume } =
    useRoomListSettings()
  const reduced = useReducedMotion()
  const animate = animationsEnabled && !reduced
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<{ node: TreeNode; x: number; y: number; conversation: boolean } | null>(null)
  // The invite picker's target: a joined room/space whose menu offered it.
  const [inviteNode, setInviteNode] = useState<TreeNode | null>(null)
  const [inviteNotice, setInviteNotice] = useState<string | null>(null)

  // Intro sequence: rows spawn in one at a time (41chan -> sub-spaces -> their
  // rooms), each growing open + revealing. `introActive` gates a row's
  // visibility until its turn. It must NEVER get in the way: ANY interaction
  // (select / toggle / right-click) aborts it and shows everything at once.
  const [appeared, setAppeared] = useState<Set<string>>(new Set())
  const [introDone, setIntroDone] = useState(false)
  const introStartedRef = useRef(false)
  const introAbortedRef = useRef(false)
  const introActive = animate && !introDone
  const abortIntro = useCallback(() => {
    introAbortedRef.current = true
    setIntroDone(true)
  }, [])

  useEffect(() => {
    // Run once, when the tree first has content + animations are on. StrictMode-
    // safe: guarded by a ref, and the timer chain checks introAbortedRef rather
    // than relying on effect cleanup (which double-fires in dev).
    if (!animate || !tree || introStartedRef.current) return
    if (tree.spaces.length === 0 && tree.orphanRooms.length === 0) return
    introStartedRef.current = true
    const order = computeRevealOrder(tree)
    let i = 0
    const step = () => {
      if (introAbortedRef.current) return
      const id = order[i]
      if (id) setAppeared((prev) => new Set(prev).add(id))
      i += 1
      if (i < order.length) setTimeout(step, INTRO_STEP_MS)
      else setTimeout(() => !introAbortedRef.current && setIntroDone(true), 300)
    }
    setTimeout(step, INTRO_START_MS)
  }, [animate, tree])

  // Report the smart default width (widest room name rule) to the sidebar.
  useEffect(() => {
    if (tree && onDefaultWidth) onDefaultWidth(computeDefaultPanelWidth(tree))
  }, [tree, onDefaultWidth])
  // `conversation` records WHERE the click came from. A row right-clicked in
  // the DM strip is one of the conversation windows whatever the room
  // classifier makes of it -- see RoomContextMenu for the two kinds that the
  // classifier correctly refuses to call DMs and that still need closing.
  const onContext = (node: TreeNode, e: React.MouseEvent, conversation = false) => {
    e.preventDefault()
    setMenu({ node, x: e.clientX, y: e.clientY, conversation })
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
      }}
    >
      {/* Fixed-height slot -- reserved whether syncing or not, so the line
          appearing/disappearing never shifts the list (no-forced-reflow-law). */}
      <div
        style={{
          height: 22,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 10px',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.3,
          color: 'var(--cpd-color-text-secondary)',
        }}
      >
        {stale ? (
          <>
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
          </>
        ) : null}
      </div>
      <style>{`
        @keyframes navStalePulse { 0%,100% { opacity: 0.5; } 50% { opacity: 0.62; } }
        @keyframes navStaleDot { 0%,100% { opacity: 0.35; } 50% { opacity: 1; } }
        @keyframes navJoinRipple {
          0%   { background: var(--cpd-color-bg-action-primary-rest); }
          100% { background: transparent; }
        }
        .nav-join-ripple { animation: navJoinRipple 900ms ease-out 1; }
        /* Toggle pills (animations sine wave / sound speaker): glow on, dim off;
           the animations wave flows on hover while on, to show what it does. */
        .tc-pill {
          display: inline-flex; align-items: center; justify-content: center;
          height: 24px; min-width: 36px; padding: 0 9px; border-radius: 999px;
          cursor: pointer; border: 1px solid rgba(128,128,128,0.35);
          background: transparent; color: var(--cpd-color-text-secondary);
          transition: color .15s ease, box-shadow .15s ease, border-color .15s ease;
        }
        .tc-pill:hover { border-color: rgba(128,128,128,0.6); }
        .tc-pill-on {
          color: var(--tc-unread, #ff9a3c);
          border-color: rgba(255,150,40,0.5);
          box-shadow: 0 0 8px rgba(255,150,40,0.4);
        }
        .tc-wave { fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; }
        @keyframes tcWaveFlow { from { transform: translateX(0); } to { transform: translateX(-12px); } }
        .tc-pill-on:hover .tc-wave { animation: tcWaveFlow 0.9s linear infinite; }
        /* Staged descent: each row drops in, delayed by its depth (--stage). */
        @keyframes navStageIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
        .nav-stage { animation: navStageIn 420ms ease-out var(--stage, 0ms) both; }
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
          animation: frNameWipe 1150ms ease-out calc(700ms + var(--stage, 0ms)) both,
                     frFlicker 1150ms steps(24, end) calc(700ms + var(--stage, 0ms)) both;
        }
        .fr-wave { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; animation: frWaveFade 2000ms ease-out var(--stage, 0ms) both; }
        .fr-sweep {
          fill: none; stroke: #ff9a3c; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;
          stroke-dasharray: 1; filter: drop-shadow(0 0 2px rgba(255,150,40,0.7));
          animation: frSweep 1500ms ease-in-out var(--stage, 0ms) both;
        }
        /* Epicycle icon reveal: hand sweeps + traces the composite (~62%), ring
           blips out (62-80%), then the icon zooms out past the ring and settles. */
        @keyframes epiDraw { 0% { stroke-dashoffset: 1; } 62%, 100% { stroke-dashoffset: 0; } }
        @keyframes epiHand { 0% { transform: rotate(-90deg); } 62%, 100% { transform: rotate(270deg); } }
        @keyframes epiOut {
          0% { opacity: 0; transform: scale(1); }
          5%, 62% { opacity: 1; transform: scale(1); }
          70% { opacity: 1; transform: scale(1.12); }
          80%, 100% { opacity: 0; transform: scale(0.15); }
        }
        @keyframes epiIconIn {
          0%, 78% { opacity: 0; transform: scale(0); }
          90% { opacity: 1; transform: scale(1.15); }
          100% { opacity: 1; transform: scale(1); }
        }
        .epi { position: relative; display: inline-grid; place-items: center; }
        .epi-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; animation: epiOut 2300ms ease-in var(--stage, 0ms) both; }
        .epi-ring { fill: none; stroke: #00b200; stroke-width: 1.4; filter: drop-shadow(0 0 3px #00b200); }
        .epi-wave { fill: none; stroke: #ff9a3c; stroke-width: 1.3; stroke-linejoin: round; stroke-dasharray: 1; filter: drop-shadow(0 0 1.5px rgba(255,150,40,0.85)); animation: epiDraw 2300ms ease-in-out var(--stage, 0ms) forwards; }
        .epi-hand-g { transform-box: view-box; transform-origin: 12px 12px; animation: epiHand 2300ms ease-in-out var(--stage, 0ms) forwards; }
        .epi-hand { stroke: #00b200; stroke-width: 1; stroke-linecap: round; opacity: 0.75; }
        .epi-spark { fill: #eaffea; filter: drop-shadow(0 0 2.5px #00b200); }
        .epi-icon { position: relative; opacity: 0; animation: epiIconIn 2300ms cubic-bezier(0.2, 0.9, 0.3, 1) var(--stage, 0ms) forwards; }
        /* Dust poof: a soft puff of dust bursts outward as the icon lands
           (shrinks back into its spot ~end of epiIconIn). */
        @keyframes epiPoof {
          0% { opacity: 0; transform: scale(0.35); }
          10% { opacity: 0.6; }
          100% { opacity: 0; transform: scale(1.9); }
        }
        .epi-poof {
          position: absolute; inset: -3px; border-radius: 50%; pointer-events: none; opacity: 0;
          background: radial-gradient(circle, rgba(212,196,160,0.55) 0%, rgba(212,196,160,0.16) 45%, transparent 70%);
          animation: epiPoof 520ms ease-out calc(2020ms + var(--stage, 0ms)) forwards;
        }
        /* The travelling bright band. Only OPACITY moves: the bright glyph is a
           second copy stacked on the dim one, and it fades in and out. It used
           to animate color and text-shadow, which are paint properties running
           forever on every letter of every pinging room name -- the shape of
           the incident in infinite-animations-cost-a-core, and enforced now by
           checks/cssAnimations.check.ts. */
        @keyframes roomLetterPulse { 0%, 40%, 60%, 100% { opacity: 0; } 50% { opacity: 1; } }
        .room-pulse-letter {
          position: relative;
          color: var(--tc-unread-base);
          text-shadow: 0 0 2px rgba(255,150,40,0.30);
        }
        .room-pulse-letter::after {
          content: attr(data-ch);
          position: absolute;
          left: 0;
          top: 0;
          color: var(--tc-unread-bright);
          text-shadow: 0 0 8px rgba(255,190,120,0.85), 0 0 2px rgba(255,150,40,0.6);
          opacity: 0;
          animation: roomLetterPulse 1600ms linear infinite;
        }
      `}</style>
      {/* Master animations toggle (seed for the future settings UI). */}
      <div style={{ padding: '2px 10px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Animations pill: a sine wave; glows on, dims off; on hover-while-on
              the wave flows to show what it does. */}
          <button
            type="button"
            onClick={() => setAnimationsEnabled(!animationsEnabled)}
            title="Room-list animations"
            className={animationsEnabled ? 'tc-pill tc-pill-on' : 'tc-pill'}
          >
            <svg width="26" height="14" viewBox="0 0 26 14" style={{ overflow: 'hidden' }}>
              <path
                className="tc-wave"
                d="M-12,7 Q-9,2.5 -6,7 T0,7 T6,7 T12,7 T18,7 T24,7 T30,7 T36,7"
              />
            </svg>
          </button>
          {/* Sound pill: doesn't do anything yet -- a speaker; on drops a volume slider. */}
          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            title="This doesn't do anything yet, but it's pretty."
            className={soundEnabled ? 'tc-pill tc-pill-on' : 'tc-pill'}
          >
            <svg width="18" height="16" viewBox="0 0 18 16">
              <path d="M2,6 H5 L9,3 V13 L5,10 H2 Z" fill="currentColor" stroke="none" />
              {soundEnabled ? (
                <>
                  <path d="M11.5,6 Q13,8 11.5,10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  <path d="M13.6,4.4 Q16.2,8 13.6,11.6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </>
              ) : (
                <line x1="11" y1="4.5" x2="16" y2="11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
        {/* Volume slider descends from the speaker pill when sound is on. */}
        <div
          style={{
            display: 'grid',
            gridTemplateRows: soundEnabled ? '1fr' : '0fr',
            transition: 'grid-template-rows 220ms ease',
          }}
        >
          <div style={{ overflow: 'hidden', minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 2px 1px', fontSize: 10, color: 'var(--cpd-color-text-secondary)' }}>
              <span>Vol</span>
              <input
                type="range"
                min={0}
                max={100}
                value={soundVolume}
                onChange={(e) => setSoundVolume(Number(e.target.value))}
                style={{ flex: 1, accentColor: 'var(--cpd-color-bg-accent-rest, #3390ff)', cursor: 'pointer' }}
              />
              <span style={{ width: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{soundVolume}%</span>
            </div>
          </div>
        </div>
      </div>
      {onSelectBooru && (
        <BooruRow active={booruActive} onSelect={onSelectBooru} />
      )}
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
          appeared={appeared}
          introActive={introActive}
          onIntroInteract={abortIntro}
        />
      ))}
      {menu && (
        <RoomContextMenu
          node={menu.node}
          x={menu.x}
          y={menu.y}
          conversation={menu.conversation}
          onClose={() => setMenu(null)}
          onInvite={
            // Offered only where the room itself says this viewer may invite
            // -- the power question answered by room state, not by role.
            menu.node.membership === 'join' && menu.node.room && client && menu.node.room.canInvite(client.getUserId() ?? '')
              ? () => setInviteNode(menu.node)
              : undefined
          }
        />
      )}
      {inviteNode && client && (
        <UserPicker
          client={client}
          title={inviteNode.isSpace ? `Invite to space: ${inviteNode.name}` : `Invite to: ${inviteNode.name}`}
          actionLabel="Inviting"
          excludeFromRoom={inviteNode.room}
          onPick={(userId) => {
            const run = async () => {
              try {
                await client.invite(inviteNode.roomId, userId)
                setInviteNotice('Invite sent.')
              } catch (err) {
                setInviteNotice(describeInviteError(err))
              }
              setInviteNode(null)
            }
            void run()
          }}
          onClose={() => setInviteNode(null)}
        />
      )}
      {inviteNotice && (
        <div
          style={{
            margin: '6px 8px',
            padding: '5px 8px',
            borderRadius: 6,
            fontSize: 11,
            border: '1px solid rgba(128,128,128,0.35)',
            color: 'var(--cpd-color-text-secondary)',
          }}
          role="status"
          onClick={() => setInviteNotice(null)}
        >
          {inviteNotice}
        </div>
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
  appeared,
  introActive,
  onIntroInteract,
  dragHandlers,
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
  // Intro sequence: a row is hidden (height 0) until it has appeared; any
  // interaction fires onIntroInteract to abort the intro (show everything).
  appeared: Set<string>
  introActive: boolean
  onIntroInteract: () => void
  // W3.4 -- pointer handlers from the parent SiblingGroup's drag layer.
  // Absent for rows that are not part of a reorderable group.
  dragHandlers?: Record<string, unknown>
}) {
  const { client } = useClient()
  const { isFavorite, isMutedNow, getRename, getRoomOrder } = useRoomListSettings()
  // W3.3 -- a local override wins over the server name, everywhere the name is
  // shown, so the nav and the room header never disagree.
  const label = getRename(node.roomId) ?? node.name ?? node.roomId
  const isCollapsed = collapsed.has(node.roomId)
  const isSelected = !node.isSpace && node.roomId === selectedRoomId
  // Launch-polish L14 (operator 2026-09-28: "Reclaim dead space to the left
  // of the roomlist so the roomlist does not have to be so wide"). Every row
  // used to reserve a 10px chevron slot and its 6px gap -- a room has no
  // chevron, so on every room row that was 16px of nothing -- and stepped
  // 12px a level on top. Now only a space draws the slot, and a level is
  // exactly that slot: a child's icon sits under its parent's icon, and a
  // child space's chevron under its parent's icon. A room one level down
  // starts 14px further left than it did.
  const indent = NAV_PAD_X + depth * NAV_CHEVRON_SLOT
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
      // Same id-time resolution as the DM strip: a node revived from the
      // cached server shape has room: null, and the click must still work.
      const live = node.room ?? client?.getRoom(node.roomId) ?? null
      if (live) onSelectRoom?.(live)
      return
    }
    if (!client || busy) return
    if (mode === 'knock') {
      setBusy(true)
      setActionError(false)
      try {
        await client.knockRoom(node.roomId)
        setKnocked(true)
      } catch (err) {
        reportAlways('room: knock', err)
        setActionError(true)
      } finally {
        setBusy(false)
      }
      return
    }
    // joinable: join, then open the room once it materializes. A pending DM
    // invite can land here too (nodeMode folds invites into joinable), so the
    // same m.direct adoption applies -- see the DM strip's click handler.
    setBusy(true)
    setActionError(false)
    const inviter = node.membership === 'invite' ? pendingDmInviter(client, node.roomId) : null
    try {
      await client.joinRoom(node.roomId)
      if (inviter) await adoptDm(client, inviter, node.roomId)
      // Same as the DM strip: configure crypto for a room joined
      // already-encrypted, in the background so the join stays responsive.
      void configureRoomEncryptionNow(client, node.roomId, { waitForUserId: inviter })
      const room = client.getRoom(node.roomId)
      if (room && !node.isSpace) onSelectRoom?.(room)
    } catch (err) {
      reportAlways('room: join', err)
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

  // W3.4 -- a saved custom order for THIS space's children, applied over the
  // server order. Rooms the order does not know about sort first, so a newly
  // joined room is noticeable rather than appended out of sight.
  const orderedChildren = arrangeSiblings(node.children, getRoomOrder(node.roomId))

  // Intro: this row is hidden (height 0) until it's its turn to spawn.
  const shown = !introActive || appeared.has(node.roomId)

  return (
    <>
      {/* Intro appear-grid: grows this row in when its turn arrives.
          data-flip-id is what the shared drag layer measures (W3.4). */}
      <div
        data-flip-id={node.roomId}
        {...dragHandlers}
        style={{
          display: 'grid',
          gridTemplateRows: shown ? '1fr' : '0fr',
          transition: animate ? 'grid-template-rows 240ms ease' : undefined,
        }}
      >
        <div style={{ overflow: 'hidden', minHeight: 0 }}>
      <div
        onClick={() => {
          onIntroInteract()
          onClick()
        }}
        onContextMenu={(e) => {
          onIntroInteract()
          onContext(node, e)
        }}
        title={knocked ? `${label} (request sent)` : label}
        className={ripple && animate ? 'nav-join-ripple' : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          paddingLeft: indent,
          paddingRight: 6,
          height: ROW_HEIGHT,
          cursor: 'pointer',
          borderRadius: 6,
          margin: `${ROW_MARGIN_Y}px 4px`,
          opacity: busy ? 0.6 : 1,
          fontWeight: mode === 'joinable' ? 700 : node.isSpace ? 600 : 400,
          color,
          // The selected row used to paint bg-action-primary-rest, which
          // resolves to gray-1400 -- the SAME token text-primary resolves to.
          // #ebeef2 on #ebeef2: the current room's name was invisible, at a
          // contrast ratio of exactly 1.00:1. That token is a SOLID, and
          // Compound pairs solids with text-on-solid-primary, not with
          // text-primary.
          //
          // Fixed by going the other way instead: a subtle fill one step above
          // the hover fill, which keeps text-primary at ~12:1, plus an accent
          // bar that carries the actual "you are here" signal. The bar is an
          // INSET shadow rather than a border so selecting a row does not
          // change its box and shift the label.
          background: isSelected ? 'var(--cpd-color-bg-subtle-primary)' : 'transparent',
          boxShadow: isSelected ? 'inset 3px 0 0 0 var(--tc-link)' : undefined,
        }}
        onMouseEnter={(e) => {
          if (!isSelected)
            e.currentTarget.style.background = 'var(--cpd-color-bg-subtle-secondary)'
        }}
        onMouseLeave={(e) => {
          if (!isSelected) e.currentTarget.style.background = 'transparent'
        }}
      >
        {node.isSpace && (
          <span style={{ width: NAV_CHEVRON_W, flexShrink: 0, textAlign: 'center', fontSize: 10, opacity: 0.7 }}>
            {isCollapsed ? '\u25B8' : '\u25BE'}
          </span>
        )}
        <EpicycleReveal seed={node.roomId} play={animate && shown}>
          <RoomIcon node={node} />
        </EpicycleReveal>
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
            <FourierReveal seed={node.roomId} play={animate && shown}>
              {label}
            </FourierReveal>
          </span>
        ) : (
          <FourierReveal seed={node.roomId} play={animate && shown}>
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
          {/* The join affordance, said out loud (operator ruling 2026-09-05):
              green means clickable, and this says so for the rooms where a
              click IS the join. Spaces are excluded -- they are the blocks
              for the mod channels and get their own handling -- and so are
              invites, which say "accept", not "join". Outside FourierReveal
              so it does not inherit the name's wipe. */}
          {mode === 'joinable' && !node.isSpace && node.membership !== 'invite' && (
            <span style={{ fontSize: 9.5, color: '#3bd16f', opacity: 0.85, whiteSpace: 'nowrap' }}>
              {'<-- Click to join'}
            </span>
          )}
        </span>
      </div>
        </div>
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
          <SiblingGroup parentId={node.roomId} childIds={orderedChildren.map((c) => c.roomId)}>
            {orderedChildren.map((child) => (
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
                appeared={appeared}
                introActive={introActive}
                onIntroInteract={onIntroInteract}
              />
            ))}
          </SiblingGroup>
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
          appeared={appeared}
          introActive={introActive}
          onIntroInteract={onIntroInteract}
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
// Intro spawn cadence: ms between each row appearing (its grow-in + reveal), and
// the initial beat before the first row. The sequence itself (computeRevealOrder)
// controls the ORDER; these control the pace. Tunable, and fully abortable.
const INTRO_STEP_MS = 130
const INTRO_START_MS = 220

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
            // The bright copy is drawn by a pseudo-element reading this
            // attribute, so the travelling band can be an opacity animation
            // rather than an infinite repaint of colour and text-shadow.
            data-ch={ch === ' ' ? '\u00a0' : ch}
            style={{ animationDelay: `${i * 90}ms` }}
          >
            {/* confusable-ok: a literal space collapses in JSX; NBSP is the rendered glyph */}
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

// W3.4 -- one reorderable sibling group (a space's children, or the root list).
//
// The drag container is the GROUP, not the sidebar's scroll element. That is
// deliberate: measureCards takes every [data-flip-id] under its container, so a
// single container over the whole tree would let a room be dropped into another
// space's slot and produce an order that means nothing. Scoping per parent
// costs edge-autoscroll -- the group does not scroll, so the autoscroll writes
// to a scrollTop that stays 0 -- but the geometry stays correct, which is the
// half that matters.
//
// Dragging is only offered while the space is EXPANDED. When collapsed, its
// favourited descendants are hoisted OUTSIDE this container, so the dragged set
// and the rendered set would disagree in exactly that state.
function SiblingGroup({
  parentId,
  childIds,
  children,
}: {
  parentId: string | null
  childIds: string[]
  children: ReactNode
}) {
  const settings = useRoomListSettings()
  const containerRef = useRef<HTMLDivElement>(null)
  const flipControlRef = useRef<FlipControl | null>(null)
  const scope = roomOrderScope(parentId)

  const orderedIds = childIds
  useFlipList(containerRef, orderedIds.join(','), flipControlRef)

  const onReorder = useCallback(
    (finalIds: string[]) => settings.setRoomOrder(scope, finalIds),
    [settings, scope],
  )

  useThreadDrag({ containerRef, orderedIds, onReorder, flipControlRef })

  return (
    <div ref={containerRef} style={{ overflow: 'hidden', minHeight: 0 }}>
      {children}
    </div>
  )
}


// The booru's row in the tree. It is not a space and never will be, but it is
// drawn as one -- same row, same weight, same selected treatment -- because
// what the user does with it is the same thing: pick where the main pane
// looks. Selecting it clears the room; selecting any room leaves it.
function BooruRow({ active, onSelect }: { active: boolean; onSelect: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect()
      }}
      title="chanbooru -- the image board, in the main pane"
      data-testid="booru-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        paddingLeft: NAV_PAD_X,
        paddingRight: 6,
        height: ROW_HEIGHT,
        cursor: 'pointer',
        borderRadius: 6,
        margin: `${ROW_MARGIN_Y}px 4px`,
        fontWeight: 600,
        fontFamily: 'var(--tc-ui-font, "Space Grotesk", system-ui, sans-serif)',
        fontSize: 13,
        color: 'var(--cpd-color-text-primary)',
        background: active ? 'var(--cpd-color-bg-subtle-primary)' : 'transparent',
        boxShadow: active ? 'inset 3px 0 0 0 var(--tc-link)' : undefined,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--cpd-color-bg-subtle-secondary)'
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent'
      }}
    >
      <span style={{ width: 10, flexShrink: 0 }} />
      <span
        aria-hidden="true"
        style={{
          width: 22,
          height: 22,
          flexShrink: 0,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--cpd-color-text-on-solid-primary)',
          background: 'var(--tc-unread, #ff9628)',
        }}
      >
        b
      </span>
      <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        chanbooru
      </span>
    </div>
  )
}
