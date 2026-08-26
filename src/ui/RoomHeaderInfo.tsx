import { useEffect, useState } from 'react'
import { EventType, RoomStateEvent, type MatrixClient, type Room } from 'matrix-js-sdk'
import { useRoomListSettings } from './roomListSettings'
import { RoomShieldBadge } from './RoomShieldBadge'

// ---------------------------------------------------------------------------
// W3.2 -- the room title line: name, joined member count, and topic.
//
// The name honours a local rename override (W3.3) so the header and the nav
// tree never disagree about what a room is called.
//
// The topic is one line with the full text in the tooltip. A room whose topic
// runs to a paragraph should not push the timeline down -- the header has a
// fixed shape and the topic lives inside it.
// ---------------------------------------------------------------------------

function readTopic(room: Room): string {
  const ev = room.currentState.getStateEvents(EventType.RoomTopic, '')
  const topic = ev?.getContent()?.topic
  return typeof topic === 'string' ? topic.replace(/\s+/g, ' ').trim() : ''
}

export function RoomHeaderInfo({ client, room }: { client: MatrixClient | null; room: Room }) {
  const settings = useRoomListSettings()
  const [topic, setTopic] = useState('')
  const [count, setCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      if (cancelled) return
      setTopic(readTopic(room))
      setCount(room.getJoinedMemberCount())
    }
    queueMicrotask(refresh)

    if (!client) return
    // Topic edits and joins/leaves both arrive as state.
    const onState = () => refresh()
    client.on(RoomStateEvent.Events, onState)
    return () => {
      cancelled = true
      client.off(RoomStateEvent.Events, onState)
    }
  }, [client, room])

  const label = settings.getRename(room.roomId) ?? room.name ?? room.roomId

  return (
    <div className="tc-room-header-info">
      <span className="tc-room-header-name" title={label}>
        {label}
      </span>
      {/* Sits next to the name, not at the end: the privacy of a conversation
          is part of what the conversation IS, and a badge after the topic gets
          pushed off the end of a long one. */}
      <RoomShieldBadge room={room} />
      {count > 0 && (
        <span className="tc-room-header-count" title={`${count} joined`}>
          {count}
        </span>
      )}
      {topic && (
        <span className="tc-room-header-topic" title={topic}>
          {topic}
        </span>
      )}
    </div>
  )
}
