import type { Look, LookAnim } from '../client/look'
import { AuthedImage } from './AuthedImage'
import { colorFor, initialsFor } from './avatarLook'
import { clipPathFor } from './avatarShape'
import { useLook } from './lookContext'

// The avatar on its own, without the pill around it -- in the person's own
// look (L24): their mask, their edge, and their animation when one is playing.
//
// AvatarPill wraps one of these; the interaction overlay draws a bare one,
// because an approach animation wants the PERSON, not the whole name plate --
// a pill sliding across the timeline reads as a UI element having come loose.
//
// THREE LAYERS, and the split is load-bearing. The face carries the mask as a
// clip-path; the body around it carries the edge as a filter; the outer box
// holds the size and is what an animation moves. A filter on the same element
// as a clip-path is clipped away with the rest of the outside (clip-path
// applies after filter), so an edge drawn there would render as nothing, with
// no error. One level up, the drop-shadows follow the mask's outline.
//
// Avatars load via the homeserver authenticated-media path, never the content
// gateway, which 403s them (D-bf01).
export function AvatarDisc({
  userId,
  name,
  avatarMxc,
  size = 22,
  look: draft,
  playing = null,
}: {
  userId: string
  name: string
  avatarMxc: string | null
  size?: number
  // A look to draw INSTEAD of the stored one: the Profile panel's preview of
  // changes not saved yet.
  look?: Look
  // The animation playing right now, if any. Whoever draws the avatar beside
  // a line decides when (Timeline's Row); the disc only knows how.
  playing?: LookAnim | null
}) {
  const stored = useLook(draft ? null : userId)
  const look = draft ?? stored
  const play = playing && playing !== 'none' ? playing : undefined
  return (
    <span className="tc-av" data-anim-play={play} style={{ width: size, height: size }}>
      {play === 'blackhole' && <span className="tc-av-hole" aria-hidden="true" />}
      <span
        className="tc-av-body"
        data-ring={look.ring !== 'none' ? look.ring : undefined}
        data-ring-color={look.ring !== 'none' ? look.ringColor : undefined}
      >
        <span
          className="tc-av-face"
          style={{
            width: size,
            height: size,
            // The mask is a clip-path, not a border-radius: only the former can
            // cut a triangle, a keyhole or a tear. It clips the coloured
            // fallback disc and the loaded image alike, so an avatar that never
            // loads is the same shape as one that does.
            clipPath: clipPathFor(look.mask),
            // Scales with the disc so a large overlay avatar is not wearing
            // tiny initials.
            fontSize: Math.max(9, Math.round(size * 0.45)),
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
      </span>
    </span>
  )
}
