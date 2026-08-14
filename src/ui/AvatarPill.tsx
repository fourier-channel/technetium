import { AuthedImage } from './AuthedImage'

// ---------------------------------------------------------------------------
// The long rounded pill carrying a person's avatar and display name together.
//
// Extracted from Timeline's SenderPill so the membership rows can show the SAME
// pill rather than one that merely resembles it -- the whole point of the
// arrival animation is that the thing popping into view is recognisably the
// person's pill, so a near-copy that drifts would undo it.
//
// Avatars load via the homeserver authenticated-media path (the content gate
// 403s them, D-bf01), degrading to a coloured initial.
// ---------------------------------------------------------------------------

// Deterministic avatar-disc colour from a user id (fallback when no avatar).
// NOT exported: a non-component export from a component file breaks fast
// refresh for the whole module (G-tp01).
function colorFor(userId: string): string {
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) % 360
  return `hsl(${h}, 55%, 45%)`
}

function initialsFor(name: string): string {
  const cleaned = name.replace(/^[@#!]/, '').trim()
  return cleaned.slice(0, 2).toUpperCase() || '?'
}

export function AvatarPill({
  userId,
  name,
  avatarMxc,
  onOpen,
  onContext,
}: {
  userId: string
  name: string
  avatarMxc: string | null
  onOpen?: (userId: string, x: number, y: number) => void
  // Right-click. Separate from onOpen because left- and right-click mean
  // different things here: look at them, versus do something to them.
  onContext?: (userId: string, x: number, y: number) => void
}) {
  return (
    <span
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen ? (e) => onOpen(userId, e.clientX, e.clientY) : undefined}
      onKeyDown={
        onOpen
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                const r = e.currentTarget.getBoundingClientRect()
                onOpen(userId, r.left, r.bottom)
              }
            }
          : undefined
      }
      onContextMenu={
        onContext
          ? (e) => {
              e.preventDefault()
              onContext(userId, e.clientX, e.clientY)
            }
          : undefined
      }
      title={onOpen ? name : undefined}
      // Makes every sender pill and membership row an anchor the
      // interaction overlay can aim at, for free.
      data-user-anchor={userId}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        maxWidth: 260,
        padding: '2px 12px 2px 2px',
        borderRadius: 999,
        background: 'var(--cpd-color-bg-subtle-secondary)',
        border: '1px solid rgba(128,128,128,0.18)',
        cursor: onOpen ? 'pointer' : undefined,
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          flexShrink: 0,
          borderRadius: '50%',
          overflow: 'hidden',
          display: 'grid',
          placeItems: 'center',
          fontSize: 10,
          fontWeight: 700,
          color: '#fff',
          background: colorFor(userId),
        }}
      >
        {avatarMxc ? (
          <AuthedImage
            mxc={avatarMxc}
            width={180}
            fill
            transparentLoading
            alt=""
            fallback={initialsFor(name)}
            viaHomeserver
          />
        ) : (
          initialsFor(name)
        )}
      </span>
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
