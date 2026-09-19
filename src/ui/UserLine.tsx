import { AvatarDisc } from './AvatarDisc'
import { avatarPx, type UserLineSize } from './userLineSize'
import type { PresenceState } from '../client/usePresence'
import '../userline.css'

// ---------------------------------------------------------------------------
// ONE WAY TO DRAW A PERSON.
//
// Operator, 2026-09-19: the member list row "shows all of the information
// needed: is this person here, are they important, are they online" -- so it
// stops being one panel's layout and becomes the template every surface uses.
//
//   lamp        presence      is this person here right now
//   honorific   rank          are they important
//   avatar      face          who they are
//   name        the name
//
// Always that order (ruled 2026-09-17), any slot omittable. The two one-glyph
// facts lead so a column reads as a status list that happens to carry faces,
// rather than a row of faces to scan past for who is online.
//
// WHAT THIS REPLACES. The same person was drawn three ways: a 34px avatar in
// the timeline, 24px in the member list, and a bare disc in the interaction
// overlay -- three sets of numbers with nothing relating them, so a change to
// one was invisible to the others. Sizes now come from formant tokens
// (--mod-userline-*), hydrated from canon. A surface says which SIZE it wants;
// it does not get to invent one.
//
// THE POINT IS HORIZONTAL SPACE. In a 380px thread panel a 34px avatar gutter
// on every line is a tenth of the width, repeated down the whole thread, to
// say something the header already said. Drawn as one line the same facts cost
// one row and give the pictures the rest.
// ---------------------------------------------------------------------------

export interface UserLineProps {
  userId: string
  name: string
  avatarMxc?: string | null
  /** Omit and no lamp is drawn. Unknown presence is NOT offline and must not
   *  be shown as either -- that would be a claim the client invented. */
  presence?: PresenceState
  /** One glyph, or null for somebody with no rank. */
  honorific?: string | null
  /** Resolved by the caller: a tier colour when the rank is backed in the room
   *  being viewed, grey when their authority lives elsewhere. This component
   *  does not know about rooms. */
  honorificColor?: string
  /** Rank glyph pulses. The RULE for when lives in memberListDisplay.ts; this
   *  only draws it. */
  pulse?: boolean
  size?: UserLineSize
  /** Multiplies every slot together, so the member list's scale slider moves
   *  the lamp, the rank, the avatar and the name as one thing. */
  scale?: number
  /** Not present in the room being viewed: the NAME greys. The honorific does
   *  not -- rank is a fact about them, presence is a fact about here. */
  dimmed?: boolean
  /** Drop the face and keep the rest. The compact member list does this: the
   *  lamp carries the same information in one pixel. */
  showAvatar?: boolean
  /** Trailing content on the same line -- a timestamp, a guild tag. */
  children?: React.ReactNode
  className?: string
  title?: string
}

export function UserLine({
  userId,
  name,
  avatarMxc = null,
  presence,
  honorific = null,
  honorificColor,
  pulse = false,
  size = 'md',
  scale = 1,
  dimmed = false,
  showAvatar = true,
  children,
  className,
  title,
}: UserLineProps) {
  const px = avatarPx(size, scale)
  // Derived from the avatar rather than set independently: that is what makes
  // one scale slider move all four slots instead of the face alone.
  const nameSize = Math.round(px * 0.6 * 10) / 10
  const honorSize = Math.round(px * 0.62 * 10) / 10

  return (
    <span
      className={'tc-userline' + (dimmed ? ' is-absent' : '') + (className ? ' ' + className : '')}
      data-size={size}
      style={{ gap: `calc(var(--mod-userline-gap) * ${scale})` }}
      title={title ?? userId}
    >
      {presence && (
        <span
          className="tc-presence-dot"
          data-presence={presence}
          title={presence === 'online' ? 'Online' : presence === 'unavailable' ? 'Away' : 'Offline'}
          aria-hidden="true"
        />
      )}
      {honorific !== null && (
        <span
          className={pulse ? 'tc-honor tc-honor-pulse' : 'tc-honor'}
          // The pulsing copy is a pseudo-element reading this attribute, so the
          // pulse animates OPACITY and never repaints colour -- the standing
          // rule after one infinite box-shadow idled a core at 45%.
          data-glyph={honorific}
          style={{
            width: `calc(var(--mod-userline-honor-w) * ${scale})`,
            fontSize: honorSize,
            color: honorificColor,
          }}
        >
          {honorific}
        </span>
      )}
      {showAvatar && (
        <span className="tc-userline-av">
          <AvatarDisc userId={userId} name={name} avatarMxc={avatarMxc} size={px} />
        </span>
      )}
      <span className="tc-userline-name" style={{ fontSize: nameSize }}>
        {name}
      </span>
      {children}
    </span>
  )
}
