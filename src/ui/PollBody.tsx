import { useMemo } from 'react'
import { M_POLL_RESPONSE, RelationType, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk'
import { buildPollResponse, tallyPoll } from '../client/polls'

// W5.3 -- poll rendering, kept isolated here so the Row's body dispatch gains
// one branch rather than a section.

export function PollBody({
  client,
  room,
  event,
}: {
  client: MatrixClient | null
  room: Room | null
  event: MatrixEvent
}) {
  const pollId = event.getId() ?? ''

  // Related events come from the loaded window, same as every other relation
  // in this client (S1): a vote whose poll has scrolled away is invisible
  // rather than half-counted.
  const related = useMemo(() => {
    if (!room) return []
    return room
      .getLiveTimeline()
      .getEvents()
      .filter((e) => {
        const rel = e.getOriginalContent()?.['m.relates_to'] as
          | { rel_type?: string; event_id?: string }
          | undefined
        return rel?.event_id === pollId && rel?.rel_type === RelationType.Reference
      })
  }, [room, pollId])

  const state = useMemo(
    () => tallyPoll(event, related, client?.getUserId() ?? null),
    [event, related, client],
  )

  if (!state) return <span style={{ fontStyle: 'italic', opacity: 0.6 }}>(unreadable poll)</span>

  const vote = async (answerId: string) => {
    if (!client || !room || state.ended || !pollId) return
    try {
      // The sdk's stable/unstable matcher decides the wire name (O-tp4), so a
      // vote is sent under whatever prefix this sdk speaks rather than one we
      // picked. threadId null: a response carries m.reference, and an event
      // has only one m.relates_to.
      await client.sendEvent(
        room.roomId,
        null,
        M_POLL_RESPONSE.name as never,
        buildPollResponse(pollId, [answerId]) as never,
      )
    } catch (err) {
      console.error('Poll vote failed:', err)
    }
  }

  const max = Math.max(1, ...state.tallies.map((t) => t.count))

  return (
    <div className="tc-poll">
      <div className="tc-poll-question">{state.definition.question}</div>
      {state.definition.answers.map((a) => {
        const tally = state.tallies.find((t) => t.answerId === a.id)
        const count = tally?.count ?? 0
        const mine = state.myAnswerIds.includes(a.id)
        return (
          <button
            key={a.id}
            type="button"
            className="tc-poll-option"
            data-mine={mine ? 'true' : undefined}
            disabled={state.ended || !client}
            aria-pressed={mine}
            onClick={() => void vote(a.id)}
            title={state.hidden ? 'Results are hidden until this poll ends' : tally?.voters.join(', ')}
          >
            {/* The fill is the tally made visible; hidden polls show no fill
                at all rather than a zero-width one, which would leak that
                nobody has voted for an option. */}
            {!state.hidden && (
              <span
                className="tc-poll-fill"
                style={{ width: `${(count / max) * 100}%` }}
                aria-hidden="true"
              />
            )}
            <span className="tc-poll-label">{a.text}</span>
            <span className="tc-poll-count">{state.hidden ? '' : count}</span>
          </button>
        )
      })}
      <div className="tc-poll-footer">
        {state.ended
          ? `Final result -- ${state.totalVoters} ${state.totalVoters === 1 ? 'vote' : 'votes'}`
          : state.hidden
            ? 'Results hidden until the poll ends'
            : `${state.totalVoters} ${state.totalVoters === 1 ? 'vote' : 'votes'}`}
      </div>
    </div>
  )
}
