import { useEffect, useRef, useState } from 'react'
import { EventType, RoomStateEvent, type MatrixClient, type Room } from 'matrix-js-sdk'
import { useRoomListSettings } from './roomListSettings'
import { RoomShieldBadge } from './RoomShieldBadge'
import { AnchoredPopup } from './AnchoredPopup'
import { useHoverPin } from './useHoverPin'
import { describeTopicError, topicEdit, topicLine, topicText } from '../client/roomTopic'

// ---------------------------------------------------------------------------
// W3.2 -- the room title line: name, joined member count, and topic.
//
// The name honours a local rename override (W3.3) so the header and the nav
// tree never disagree about what a room is called.
//
// The topic is where a room keeps its quick rules (operator, 2026-10-10). In
// the header it is one line -- a paragraph must not push the timeline down --
// and the whole of it, line breaks kept, is a hover-pin popup behind that line
// (useHoverPin: hover with a mouse, tap on a phone, where a tooltip never
// shows). Anyone whose level lets them send m.room.topic gets a pencil on the
// same line that edits it in place, without leaving the chat; who that is, is
// the SDK's own rule (maySendStateEvent: the room's power levels and our own
// membership, both in sliding sync's required state).
//
// Its host keys it by room (Timeline): the editor's open state and draft
// belong to ONE room, and the header outlives a switch to another.
// ---------------------------------------------------------------------------

function readTopic(room: Room): string {
  return topicText(room.currentState.getStateEvents(EventType.RoomTopic, '')?.getContent())
}

function mayEditTopic(client: MatrixClient | null, room: Room): boolean {
  const me = client?.getUserId()
  return !!me && room.currentState.maySendStateEvent(EventType.RoomTopic, me)
}

export function RoomHeaderInfo({ client, room }: { client: MatrixClient | null; room: Room }) {
  const settings = useRoomListSettings()
  const [topic, setTopic] = useState('')
  const [count, setCount] = useState(0)
  const [canEdit, setCanEdit] = useState(false)
  const [editing, setEditing] = useState(false)
  // The draft outlives the popup: a stray tap outside closes the editor, and
  // reopening it finds the text as it was left. Cancel and a save clear it.
  const [draft, setDraft] = useState<string | null>(null)
  const topicRef = useRef<HTMLButtonElement>(null)
  const pencilRef = useRef<HTMLButtonElement>(null)
  const pin = useHoverPin(topicRef, 'tc-topic-full')

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      if (cancelled) return
      setTopic(readTopic(room))
      setCount(room.getJoinedMemberCount())
      setCanEdit(mayEditTopic(client, room))
    }
    queueMicrotask(refresh)

    if (!client) return
    // Topic edits, joins and leaves, and level changes all arrive as state.
    const onState = () => refresh()
    client.on(RoomStateEvent.Events, onState)
    return () => {
      cancelled = true
      client.off(RoomStateEvent.Events, onState)
    }
  }, [client, room])

  const label = settings.getRename(room.roomId) ?? room.name ?? room.roomId
  const line = topicLine(topic)

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
      {line && (
        <button ref={topicRef} type="button" className="tc-room-header-topic" aria-haspopup="dialog" {...pin.anchor}>
          {line}
        </button>
      )}
      {line && pin.open && !editing && (
        <AnchoredPopup key={pin.popupKey} anchorRef={topicRef} label="Room topic" {...pin.popup}>
          {topic}
        </AnchoredPopup>
      )}
      {canEdit && client && (
        <button
          ref={pencilRef}
          type="button"
          className="tc-room-header-edit"
          aria-label={line ? 'Edit the room topic' : 'Add a room topic'}
          title={line ? 'Edit the room topic' : 'Add a room topic'}
          aria-expanded={editing}
          onClick={() => setEditing((e) => !e)}
        >
          <PencilIcon />
        </button>
      )}
      {editing && client && (
        <AnchoredPopup anchorRef={pencilRef} onClose={() => setEditing(false)} label="Edit the room topic" className="tc-topic-editor">
          <TopicEditor
            client={client}
            room={room}
            current={topic}
            draft={draft ?? topic}
            onDraft={setDraft}
            onHide={() => setEditing(false)}
            onDone={() => {
              setDraft(null)
              setEditing(false)
            }}
          />
        </AnchoredPopup>
      )}
    </div>
  )
}

// The editor: the topic as written, line breaks and all. Enter is a new line
// (rules are lists); Ctrl or Cmd+Enter saves; Escape closes, keeping the draft. Save shows that it is saving and,
// on failure, keeps the text and says what to do (describeTopicError). It
// closes when the server has taken the change; the header redraws from the
// state event sync brings back, not from this draft.
function TopicEditor({
  client,
  room,
  current,
  draft,
  onDraft,
  onHide,
  onDone,
}: {
  client: MatrixClient
  room: Room
  current: string
  draft: string
  onDraft: (d: string) => void
  /** Close, keeping the draft (Escape, as a stray tap outside does). */
  onHide: () => void
  onDone: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { next, changed } = topicEdit(draft, current)

  const save = () => {
    if (!changed || saving) return
    setSaving(true)
    setError(null)
    client
      .setRoomTopic(room.roomId, next)
      .then(() => onDone())
      .catch((err: unknown) => {
        console.warn('room topic not saved:', err)
        setError(describeTopicError(err))
        setSaving(false)
      })
  }

  return (
    <div className="tc-topic-editor-body">
      <label className="tc-topic-editor-label" htmlFor="tc-topic-draft">
        Room topic. Every Matrix client shows it, so it is where this room keeps its rules.
      </label>
      <textarea
        id="tc-topic-draft"
        className="tc-topic-editor-text"
        value={draft}
        rows={6}
        disabled={saving}
        placeholder="One line, or a short list of rules"
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            save()
          } else if (e.key === 'Escape' && !saving) {
            // AnchoredPopup leaves Escape to a field being typed in; here it
            // closes, and the draft waits for the pencil.
            e.preventDefault()
            onHide()
          }
        }}
      />
      {error && <div className="tc-topic-editor-error" role="alert">{error}</div>}
      <div className="tc-topic-editor-actions">
        <button type="button" className="tc-pill" onClick={onDone} disabled={saving}>
          Cancel
        </button>
        <button type="button" className="tc-pill tc-topic-editor-save" onClick={save} disabled={!changed || saving}>
          {saving ? 'Saving...' : next === '' && current !== '' ? 'Remove topic' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// A pencil, drawn rather than typed (PushpinIcon says why). currentColor.
function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M11.7 1.3a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4l-8.6 8.6-3.4.9a.5.5 0 0 1-.6-.6l.9-3.4zM10.6 3.8 3.9 10.5l-.5 1.9 1.9-.5L12 5.2z"
      />
    </svg>
  )
}
