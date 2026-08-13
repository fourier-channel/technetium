import type { MatrixEvent } from 'matrix-js-sdk'
import { useClient } from '../client/ClientContext'
import {
  arrivalAnimation,
  describeMemberEvent,
  memberPhrase,
  type MemberContent,
} from '../client/memberEvents'
import { AvatarPill } from './AvatarPill'
import { useProfileOpener } from './profileOpener'
import { useReducedMotion } from './reducedMotion'
import { useReplayOnView } from './useReplayOnView'

// ---------------------------------------------------------------------------
// A membership event, rendered as the person rather than as `[m.room.member]`.
//
// An ARRIVAL gets a sudden-appearance animation: the person's own avatar pill
// bursts into the log. Which of the variants plays is picked from the event id,
// so a given join always looks the same on replay while the log varies -- a
// fresh random pick per replay would make one row look like a different event
// each time it scrolled past, which reads as a rendering glitch rather than as
// character.
//
// Everything else -- leaves, kicks, bans, profile edits -- is a quiet static
// line. Motion in the log therefore MEANS something: somebody arrived.
//
// The animation replays on each entry into view (useReplayOnView), because
// scrolling to a message is a deliberate act. Read the log straight through and
// each one plays exactly once.
// ---------------------------------------------------------------------------

export function MemberEvent({ event }: { event: MatrixEvent }) {
  const { client } = useClient()
  const openProfile = useProfileOpener()
  const reduced = useReducedMotion()

  const description = describeMemberEvent({
    content: event.getContent() as MemberContent,
    prevContent: event.getPrevContent() as MemberContent,
    sender: event.getSender(),
    stateKey: event.getStateKey(),
  })

  const animated = description.arrival && !reduced
  const { ref, playKey } = useReplayOnView(animated)

  const eventId = event.getId() ?? ''
  const phrase = memberPhrase(description, eventId)

  // The member's CURRENT avatar wins over the one the event recorded: we know
  // what their pill looks like right now, and a log scrolled back a month
  // should still show a recognisable person. The event's own copy is the
  // fallback for someone who has since left and has no member entry left.
  const member = client?.getRoom(event.getRoomId() ?? '')?.getMember(description.userId) ?? null
  const avatarMxc = member?.getMxcAvatarUrl() ?? description.avatarUrl
  const name = member?.name || description.name

  const time = new Date(event.getTs()).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="tc-member-row" ref={ref} data-transition={description.transition}>
      {/* Remounted by playKey so the CSS animation restarts from frame one.
          playKey 0 = never yet in view, so it renders static rather than
          animating something nobody is looking at. */}
      <span
        key={playKey}
        className={
          animated && playKey > 0
            ? `tc-member-pop tc-mev-${arrivalAnimation(eventId)}`
            : undefined
        }
      >
        <AvatarPill
          userId={description.userId}
          name={name}
          avatarMxc={avatarMxc}
          onOpen={openProfile}
        />
      </span>
      <span className="tc-member-phrase">{phrase}</span>
      <span className="tc-member-time">{time}</span>
    </div>
  )
}
