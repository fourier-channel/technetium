import { useState } from 'react'
import { EventType, RelationType, type MatrixClient } from 'matrix-js-sdk'
import type { TimelineItem } from '../client/useTimeline'
import type { ReactionTally } from '../client/relations'
import { EmojiPicker } from './EmojiPicker'
import { useReactTarget } from './reactTarget'
import { useRoving } from './roving'

// ---------------------------------------------------------------------------
// W2.5 -- the reactions strip in the row footer.
//
// Reads its tallies from the S1 relation index, so the aggregation, the
// own-reaction flag and the annotation id needed to un-react are all resolved
// before this component sees them. Clicking toggles: send an m.annotation, or
// redact the one you already sent.
// ---------------------------------------------------------------------------

// A local echo has no server-side event id yet, so nothing can annotate it.
function isSendable(eventId: string): boolean {
  return !!eventId && !eventId.startsWith('~')
}

export function ReactionStrip({
  item,
  client,
  roomId,
}: {
  item: TimelineItem
  client: MatrixClient | null
  roomId: string
}) {
  // The action bar's React verb and the strip's own "+" must open ONE picker.
  // The open target is therefore owned above both, keyed by event id, rather
  // than each keeping its own boolean.
  const { target, setTarget } = useReactTarget()
  const [localOpen, setLocalOpen] = useState(false)
  const pickerOpen = localOpen || target === item.id

  const closePicker = () => {
    setLocalOpen(false)
    if (target === item.id) setTarget(null)
  }
  const tallies = item.reactions ?? []
  // Pills plus the trailing "+" button.
  const roving = useRoving(tallies.length + 1)

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
      console.error('Reaction toggle failed:', err)
    }
  }

  if (tallies.length === 0 && !pickerOpen && !sendable) return null

  return (
    <div
      className="tc-reactions"
      role="group"
      aria-label="Reactions"
      onKeyDown={roving.onKeyDown}
    >
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
          <span className="tc-reaction-key">{t.key}</span>
          <span className="tc-reaction-count">{t.count}</span>
        </button>
      ))}

      {/* Anchored to .tc-row, which is position:relative. */}
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <button
          type="button"
          className="tc-reaction tc-reaction-add"
          title="Add reaction"
          aria-label="Add reaction"
          aria-expanded={pickerOpen}
          disabled={!sendable}
          onClick={() => (pickerOpen ? closePicker() : setLocalOpen(true))}
          {...roving.itemProps(tallies.length)}
        >
          {'+'}
        </button>
        {pickerOpen && (
          <EmojiPicker
            onPick={(emoji) => {
              closePicker()
              void toggle(
                emoji,
                tallies.find((t) => t.key === emoji),
              )
            }}
            onClose={closePicker}
          />
        )}
      </span>
    </div>
  )
}
