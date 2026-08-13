import { useState } from 'react'
import { EventType, RelationType, type MatrixClient } from 'matrix-js-sdk'
import type { TimelineItem } from '../client/useTimeline'
import type { ReactionTally } from '../client/relations'
import { EmojiPicker } from './EmojiPicker'
import { useReactTarget } from './reactTarget'
import { useRoving } from './roving'
import { isCustomEmojiKey } from '../client/emojiPacks'
import { AuthedImage } from './AuthedImage'
import { reportAlways } from '../client/report'

// ---------------------------------------------------------------------------
// W2.5 -- reactions.
//
// Reads its tallies from the S1 relation index, so the aggregation, the
// own-reaction flag and the annotation id needed to un-react are all resolved
// before this component sees them. Clicking toggles: send an m.annotation, or
// redact the one you already sent.
//
// SPLIT into two pieces (2026-08-13) because they are placed differently:
//
//   ReactionAdd   -- the "+" affordance and its picker.
//   ReactionPills -- the tallies.
//
// The add affordance is revealed on hover, so it must NEVER be inserted into
// layout when it appears: it occupies its slot at all times and only changes
// opacity. Growing a row on hover moved every message above it, because the
// timeline re-pins to the bottom while following. That is why the two are
// separable at all -- the "+" goes where it costs no height (beside a media
// body in the rail, or in a reserved inline slot after a text body), while the
// tallies go where they read naturally, which is not the same place.
// ---------------------------------------------------------------------------

// A local echo has no server-side event id yet, so nothing can annotate it.
function isSendable(eventId: string): boolean {
  return !!eventId && !eventId.startsWith('~')
}

// The toggle both halves share. Not a component: the "+" and the pills each
// need it, and duplicating the redact-vs-send rule is how the two would drift.
function useReactionToggle(
  item: TimelineItem,
  client: MatrixClient | null,
  roomId: string,
): { toggle: (key: string, existing?: ReactionTally) => Promise<void>; sendable: boolean } {
  const sendable = isSendable(item.id)

  const toggle = async (key: string, existing?: ReactionTally) => {
    if (!client || !sendable) return
    try {
      if (existing?.mine && existing.myEventId) {
        // Un-reacting is redacting your OWN annotation -- which is why S1
        // captures myEventId rather than just a boolean.
        await client.redactEvent(roomId, existing.myEventId)
      } else {
        // threadId null: an annotation must not carry an m.thread relation --
        // an event can only have one m.relates_to.
        await client.sendEvent(roomId, null, EventType.Reaction, {
          'm.relates_to': { rel_type: RelationType.Annotation, event_id: item.id, key },
        })
      }
    } catch (err) {
      // User-initiated send: reported every time, not deduped (D-tp16).
      reportAlways('reaction: toggle', err)
    }
  }

  return { toggle, sendable }
}

// The "+" and the picker it opens. Rendered whenever the message can be
// reacted to -- present in layout at all times, revealed by CSS on hover or
// focus. `inline` places it in the reserved slot trailing a text body; without
// it, it sits at the top of a media row's rail.
export function ReactionAdd({
  item,
  client,
  roomId,
  inline = false,
}: {
  item: TimelineItem
  client: MatrixClient | null
  roomId: string
  inline?: boolean
}) {
  // The action bar's React verb and this "+" must open ONE picker. The open
  // target is therefore owned above both, keyed by event id, rather than each
  // keeping its own boolean.
  const { target, setTarget } = useReactTarget()
  const [localOpen, setLocalOpen] = useState(false)
  const pickerOpen = localOpen || target === item.id
  const { toggle, sendable } = useReactionToggle(item, client, roomId)

  const closePicker = () => {
    setLocalOpen(false)
    if (target === item.id) setTarget(null)
  }

  return (
    // Anchors the picker. .tc-row is position:relative, but the picker should
    // open from the button, not from the row's corner.
    <span
      className={inline ? 'tc-reaction-add-slot tc-reaction-add-inline' : 'tc-reaction-add-slot'}
    >
      <button
        type="button"
        className="tc-reaction tc-reaction-add"
        title="Add reaction"
        aria-label="Add reaction"
        aria-expanded={pickerOpen}
        disabled={!sendable}
        onClick={() => (pickerOpen ? closePicker() : setLocalOpen(true))}
      >
        {'+'}
      </button>
      {pickerOpen && (
        <EmojiPicker
          onPick={(emoji) => {
            closePicker()
            void toggle(
              emoji,
              (item.reactions ?? []).find((t) => t.key === emoji),
            )
          }}
          onClose={closePicker}
        />
      )}
    </span>
  )
}

// The tallied pills. Renders nothing at all when there are none, so a message
// with no reactions reserves no footer -- the pills are real content and are
// the only part of this that is allowed to change a row's height.
export function ReactionPills({
  item,
  client,
  roomId,
}: {
  item: TimelineItem
  client: MatrixClient | null
  roomId: string
}) {
  const tallies = item.reactions ?? []
  const roving = useRoving(tallies.length)
  const { toggle, sendable } = useReactionToggle(item, client, roomId)

  if (tallies.length === 0) return null

  return (
    <div className="tc-reactions" role="group" aria-label="Reactions" onKeyDown={roving.onKeyDown}>
      {tallies.map((t, i) => (
        <button
          key={t.key}
          type="button"
          className="tc-reaction"
          data-mine={t.mine ? 'true' : undefined}
          aria-pressed={t.mine}
          disabled={!sendable}
          title={t.senders.join(', ')}
          onClick={() => void toggle(t.key, t)}
          {...roving.itemProps(i)}
        >
          {/* A custom-emoji reaction's KEY is an mxc uri (MSC2545), so it
              renders as an image rather than as literal "mxc://..." text. */}
          <span className="tc-reaction-key">
            {isCustomEmojiKey(t.key) ? (
              <AuthedImage mxc={t.key} width={180} fill transparentLoading alt="" fallback="?" />
            ) : (
              t.key
            )}
          </span>
          <span className="tc-reaction-count">{t.count}</span>
        </button>
      ))}
    </div>
  )
}

// A media body's reactions: a column to the RIGHT of the picture, top-aligned,
// spilling downward. The "+" is pinned at the TOP of the column rather than
// after the pills, so it stays directly beside the thumbnail's top edge no
// matter how many reactions accumulate -- an affordance that moves as content
// arrives is one the user has to re-find.
export function ReactionRail({
  item,
  client,
  roomId,
}: {
  item: TimelineItem
  client: MatrixClient | null
  roomId: string
}) {
  return (
    <div className="tc-reaction-rail">
      <ReactionAdd item={item} client={client} roomId={roomId} />
      <ReactionPills item={item} client={client} roomId={roomId} />
    </div>
  )
}
