import type { TreeNode } from '../client/spaces'
import { useRoomListSettings } from './roomListSettings'
import { AuthedImage } from './AuthedImage'
import { frHash } from './frHash'

// A room's face and the reveal it arrives with, drawn the same wherever a
// room or a conversation is listed: the room list's rows, and since
// launch-polish L30 the Direct Messages section in the user list. Moved out
// of NavTree.tsx whole when that section moved, so the two lists draw one
// icon rather than two that drift apart (D-tc01).

// Icon to the left of a room/space name: a user-set emoji/glyph override
// (right-click -> Set icon), else the room/space avatar, else a generated
// initial. Spaces get a rounded-square frame, rooms a circle.
// Epicycle icon reveal (Ask 2026-07-19): a green-glow ring; a clock hand sweeps
// once, its spark tracing the N-harmonic composite drawn as a POLAR wavy loop
// (squarer with more harmonics -- precomputed, same per-room count as the name);
// the ring blips out and the real icon zooms from a point to slightly-larger-
// than-the-ring, then settles in. Green = #00b200 (the landing "Fourier green").
function polarWaveLoop(harmonics: number): string {
  const cx = 12, cy = 12, baseR = 7, amp = 1.9, samples = 96
  const pts: string[] = []
  for (let i = 0; i <= samples; i++) {
    const th = (i / samples) * Math.PI * 2
    let v = 0
    for (let k = 0; k < harmonics; k++) {
      const n = 2 * k + 1
      v += Math.sin(n * th) / n
    }
    v *= 4 / Math.PI
    const r = baseR + amp * v
    pts.push(`${(cx + r * Math.cos(th)).toFixed(2)},${(cy + r * Math.sin(th)).toFixed(2)}`)
  }
  return 'M' + pts.join(' L') + 'Z'
}
const EPI_LOOPS: Record<number, string> = {
  2: polarWaveLoop(2),
  3: polarWaveLoop(3),
  4: polarWaveLoop(4),
  5: polarWaveLoop(5),
}

export function EpicycleReveal({
  children,
  seed,
  size = 20,
  play,
}: {
  children: React.ReactNode
  seed: string
  size?: number
  play: boolean
}) {
  if (!play) return <>{children}</>
  const harmonics = 2 + (frHash(seed) % 4)
  return (
    <span className="epi" style={{ width: size, height: size, flexShrink: 0 }}>
      <svg className="epi-svg" viewBox="0 0 24 24" aria-hidden="true">
        <circle className="epi-ring" cx="12" cy="12" r="9" />
        <path className="epi-wave" pathLength={1} d={EPI_LOOPS[harmonics]} />
        <g className="epi-hand-g">
          <line className="epi-hand" x1="12" y1="12" x2="12" y2="4.2" />
          <circle className="epi-spark" cx="12" cy="4.2" r="1.3" />
        </g>
      </svg>
      <span className="epi-poof" aria-hidden="true" />
      <span className="epi-icon">{children}</span>
    </span>
  )
}

export function RoomIcon({ node, size = 20, isDm = false }: { node: TreeNode; size?: number; isDm?: boolean }) {
  const { getIcon } = useRoomListSettings()
  const override = getIcon(node.roomId)
  // getAvatarFallbackMember() returns the other party ONLY for a genuine
  // two-person DM (it counts non-functional members and gives up above two),
  // and it reads the sliding-sync heroes, so it works without the roster
  // loaded. undefined for a group room -- which then falls through to the
  // room's own avatar, as before.
  const dmMember = isDm ? (node.room?.getAvatarFallbackMember() ?? null) : null
  const avatarMxc = dmMember?.getMxcAvatarUrl() ?? node.room?.getMxcAvatarUrl() ?? null

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

  // A DM with no avatar falls back to the PERSON's initial, not the room's --
  // an unavatared DM room is usually named after its members anyway, but the
  // member name is the one that is always right.
  const initial =
    (dmMember?.name || dmMember?.userId || node.name || node.roomId)
      .replace(/^[#!@]/, '')
      .charAt(0)
      .toUpperCase() || '#'

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
        <AuthedImage mxc={avatarMxc} width={180} fill transparentLoading alt="" fallback={initial} />
      </span>
    )
  return (
    <span style={frame} aria-hidden>
      {initial}
    </span>
  )
}
