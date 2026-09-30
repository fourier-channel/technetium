import { AvatarDisc } from './AvatarDisc'
import { personGestures } from './personGesture'

// ---------------------------------------------------------------------------
// The long rounded pill carrying a person's avatar and display name together.
//
// Extracted from Timeline's SenderPill so the membership rows can show the SAME
// pill rather than one that merely resembles it -- the whole point of the
// arrival animation is that the thing popping into view is recognisably the
// person's pill, so a near-copy that drifts would undo it.
//
// The disc itself now lives in ./AvatarDisc for the same reason one step
// further down: the interaction overlay draws a bare disc, and it has to be
// THIS disc. Avatars load via the homeserver authenticated-media path (the
// content gate 403s them, D-bf01), degrading to a coloured initial.
// ---------------------------------------------------------------------------

export function AvatarPill({
  userId,
  name,
  avatarMxc,
  onAct,
  onLook,
}: {
  userId: string
  name: string
  avatarMxc: string | null
  // Left click: the chat actions. Right click: the profile preview. The same
  // two as every other place a person is drawn (L23, personGesture.ts).
  onAct?: (userId: string, x: number, y: number) => void
  onLook?: (userId: string, x: number, y: number) => void
}) {
  const clickable = !!(onAct ?? onLook)
  return (
    <span
      {...personGestures(userId, onAct, onLook)}
      title={clickable ? name : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        maxWidth: 260,
        padding: '2px 12px 2px 2px',
        borderRadius: 999,
        background: 'var(--cpd-color-bg-subtle-secondary)',
        border: '1px solid rgba(128,128,128,0.18)',
        cursor: clickable ? 'pointer' : undefined,
      }}
    >
      <AvatarDisc userId={userId} name={name} avatarMxc={avatarMxc} size={22} />
      <span
        style={{
          fontFamily: 'var(--tc-ui-font, inherit)',
          fontWeight: 600,
          fontSize: 13,
          color: 'var(--cpd-color-text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>
    </span>
  )
}
