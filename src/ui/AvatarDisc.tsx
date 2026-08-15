import { AuthedImage } from './AuthedImage'
import { colorFor, initialsFor } from './avatarLook'

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
  return (
    <span
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
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
          viaHomeserver
        />
      ) : (
        initialsFor(name)
      )}
    </span>
  )
}
