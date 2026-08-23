import { useClient } from '../client/ClientContext'
import { AuthedImage } from './AuthedImage'
import { colorFor, initialsFor } from './avatarLook'
import { clipPathFor, resolveAvatarShape, useAvatarShape } from './avatarShape'

// The round avatar disc on its own, without the pill around it.
//
// AvatarPill wraps one of these; the interaction overlay draws a bare one,
// because an approach animation wants the PERSON, not the whole name plate --
// a pill sliding across the timeline reads as a UI element having come loose.
//
// Avatars load via the homeserver authenticated-media path, never the content
// gateway, which 403s them (D-bf01).
export function AvatarDisc({
  userId,
  name,
  avatarMxc,
  size = 22,
}: {
  userId: string
  name: string
  avatarMxc: string | null
  size?: number
}) {
  const { client } = useClient()
  const { shape } = useAvatarShape()
  // Resolved here rather than passed down from every call site, so a member
  // row, a timeline line and the interaction overlay all agree without any of
  // them having to know the rule.
  const mask = resolveAvatarShape(userId, client?.getUserId() ?? null, shape)
  return (
    <span
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        // The mask is a clip-path, not a border-radius: only the former can cut
        // a triangle, a keyhole or a tear. It clips the coloured fallback disc
        // and the loaded image alike, so an avatar that never loads is the same
        // shape as one that does.
        clipPath: clipPathFor(mask),
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
        // Scales with the disc so a large overlay avatar is not wearing tiny
        // initials.
        fontSize: Math.max(9, Math.round(size * 0.45)),
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
        />
      ) : (
        initialsFor(name)
      )}
    </span>
  )
}
