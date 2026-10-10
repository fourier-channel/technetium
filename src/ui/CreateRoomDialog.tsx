import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MatrixClient } from 'matrix-js-sdk'
import { createRoom, type HouseJoinRule } from '../client/createRoom'

// W3.9 -- minimal create dialog. Name, topic, room-or-space, an optional parent
// space, join rule, federation and encryption.
//
// WHO SEES IT. Only server admins: the homeserver refuses room creation to
// everyone else (fourier-basis ops/hetzner/synapse/modules/
// room_creation_policy.py, operator ruling 2026-09-07), so the one entry point
// is the admin-only Server permissions panel. Offering it anywhere an ordinary
// account could reach would be offering a button that always fails.

const JOIN_RULES: { value: HouseJoinRule; label: string; hint: string }[] = [
  {
    value: 'restricted',
    label: 'Members of its space',
    hint: 'Anyone in the space it goes in can join -- how every room in a space here works.',
  },
  { value: 'invite', label: 'Invite only', hint: 'Only people you invite can join.' },
  { value: 'knock', label: 'Ask to join', hint: 'Anyone can request an invite.' },
  { value: 'public', label: 'Public', hint: 'Anyone who knows the address can join.' },
]

export function CreateRoomDialog({
  client,
  onCreated,
  onClose,
  initialParentSpaceId = '',
}: {
  client: MatrixClient
  onCreated: (roomId: string, name: string) => void
  onClose: () => void
  // Preselect the space it goes in, when the caller already knows.
  initialParentSpaceId?: string
}) {
  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  const [isSpace, setIsSpace] = useState(false)
  const [parentSpaceId, setParentSpaceId] = useState(initialParentSpaceId)
  // The join rule FOLLOWS the space choice until somebody picks one: inside a
  // space the house rule is "members of its space"; at the top level there is
  // no space to be a member of, so it falls back to invite-only.
  const [joinRule, setJoinRule] = useState<HouseJoinRule>(initialParentSpaceId ? 'restricted' : 'invite')
  const [joinPicked, setJoinPicked] = useState(false)
  // Default OFF. Federation and encryption are the two settings on this form
  // that cannot be changed afterwards, so both default to the direction that
  // leaves the most choices open, and both say so.
  const [federate, setFederate] = useState(false)
  const [encrypted, setEncrypted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set when the room was created but could not be parented -- the room EXISTS,
  // and the id has to reach the user so it can be adopted by hand.
  const [orphanNotice, setOrphanNotice] = useState<string | null>(null)
  // A close is honoured only when the press STARTED on the backdrop too:
  // drag-selecting a field and letting go outside the panel sends the click to
  // the backdrop, and would throw the form away.
  const downOnBackdrop = useRef(false)
  // Nothing closes the dialog while a create is in flight. The request cannot
  // be taken back, and closing would drop its outcome -- including the id of a
  // room that was created but could not be put in its space.
  const close = () => {
    if (!busy) onClose()
  }

  const spaces = useMemo(
    () =>
      client
        .getRooms()
        .filter((r) => r.isSpaceRoom() && r.getMyMembership() === 'join')
        .map((r) => ({ roomId: r.roomId, name: r.name || r.roomId }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [client],
  )

  const submit = async () => {
    if (busy || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const result = await createRoom(client, {
        name,
        topic,
        isSpace,
        joinRule,
        federate,
        encrypted,
        parentSpaceId: parentSpaceId || undefined,
      })
      if (result.parentError) {
        // Do NOT close: the user has to see the id of the room that exists.
        setOrphanNotice(
          `Created, but not added to the space -- ${result.parentError}. ` +
            `The ${isSpace ? 'space' : 'room'} exists: ${result.roomId}`,
        )
        setBusy(false)
        return
      }
      onCreated(result.roomId, name.trim())
    } catch (err) {
      const e = err as { message?: string; httpStatus?: number; errcode?: string }
      setError(
        e?.httpStatus === 403 || e?.errcode === 'M_FORBIDDEN'
          // room_creation_policy.py: DMs and server admins only. Said with its
          // fix, since the one account that sees this dialog should pass.
          ? 'The homeserver refused: only server administrators may create rooms here, and it does not count ' +
              'this account as one. Check the account is marked admin on the server itself.'
          : (e?.message ?? 'Could not create it.'),
      )
      setBusy(false)
    }
  }

  // Formant's field, a form row wide (.tc-input[data-wide], which sizes by
  // border-box so a text input's edge lines up with a select's).
  const field = { className: 'tc-input', 'data-wide': 'true', style: { marginBottom: 10 } } as const

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create a room or space"
      onMouseDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        const fromBackdrop = downOnBackdrop.current && e.target === e.currentTarget
        downOnBackdrop.current = false
        if (fromBackdrop) close()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close()
      }}
      className="tc-modal-scrim"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="tc-modal"
        style={{ maxHeight: '80dvh', overflowY: 'auto' }}
      >
        <div className="tc-modal-title">
          Create a {isSpace ? 'space' : 'room'}
        </div>

        {/* Locked while a create is in flight, and after one that left a room
            outside its space: what is on screen must stay what was sent. */}
        <fieldset disabled={busy || !!orphanNotice} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <TypeBtn active={!isSpace} onClick={() => setIsSpace(false)}>
              Room
            </TypeBtn>
            <TypeBtn active={isSpace} onClick={() => setIsSpace(true)}>
              Space
            </TypeBtn>
          </div>

          <label className="tc-modal-label" htmlFor="tc-create-name">
            Name
          </label>
          <input
            id="tc-create-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            {...field}
          />

          <label className="tc-modal-label" htmlFor="tc-create-topic">
            Topic (optional)
          </label>
          <input
            id="tc-create-topic"
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            {...field}
          />

          {spaces.length > 0 && (
            <>
              <label className="tc-modal-label" htmlFor="tc-create-parent">
                Put it inside (optional)
              </label>
              <select
                id="tc-create-parent"
                value={parentSpaceId}
                onChange={(e) => {
                  const next = e.target.value
                  setParentSpaceId(next)
                  if (!joinPicked) setJoinRule(next ? 'restricted' : 'invite')
                  // A picked "members of its space" with no space left to be a
                  // member of would be refused at Create; say it now instead --
                  // and since that overrode the pick, the rule follows the space
                  // choice again rather than staying invite-only in the next one.
                  else if (!next && joinRule === 'restricted') {
                    setJoinRule('invite')
                    setJoinPicked(false)
                  }
                }}
                {...field}
              >
                <option value="">Nowhere -- top level</option>
                {spaces.map((s) => (
                  <option key={s.roomId} value={s.roomId}>
                    {s.name}
                  </option>
                ))}
              </select>
            </>
          )}

          <label className="tc-modal-label" htmlFor="tc-create-join">
            Who can join
          </label>
          <select
            id="tc-create-join"
            value={joinRule}
            onChange={(e) => {
              setJoinRule(e.target.value as HouseJoinRule)
              setJoinPicked(true)
            }}
            {...field}
          >
            {JOIN_RULES.filter((r) => r.value !== 'restricted' || parentSpaceId).map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <div className="tc-modal-hint" style={{ marginTop: -6, marginBottom: 10 }}>
            {JOIN_RULES.find((r) => r.value === joinRule)?.hint}
          </div>

          <label className="tc-modal-label" htmlFor="tc-create-federate">
            Other servers
          </label>
          <label
            htmlFor="tc-create-federate"
            style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4, cursor: 'pointer' }}
          >
            <input
              id="tc-create-federate"
              type="checkbox"
              checked={federate}
              onChange={(e) => setFederate(e.target.checked)}
              style={{ marginTop: 2, flexShrink: 0 }}
            />
            <span style={{ fontSize: 13 }}>
              Allow people from other Matrix servers to join
            </span>
          </label>
          <div className="tc-modal-hint" data-tone={federate ? 'warn' : undefined} style={{ marginBottom: 12 }}>
            {federate
              ? 'Cannot be undone later. Every server a member joins from receives a permanent copy of everything posted here, and can fetch any image it has seen.'
              : 'This ' +
                (isSpace ? 'space' : 'room') +
                ' will exist only on this server. Permanent either way -- this cannot be changed after creation.'}
          </div>

          <label className="tc-modal-label" htmlFor="tc-create-encrypted">
            Encryption
          </label>
          <label
            htmlFor="tc-create-encrypted"
            style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4, cursor: 'pointer' }}
          >
            <input
              id="tc-create-encrypted"
              type="checkbox"
              checked={encrypted}
              onChange={(e) => setEncrypted(e.target.checked)}
              style={{ marginTop: 2, flexShrink: 0 }}
            />
            <span style={{ fontSize: 13 }}>
              End-to-end encrypt everything posted here
            </span>
          </label>
          <div className="tc-modal-hint" data-tone={encrypted ? 'warn' : undefined} style={{ marginBottom: 12 }}>
            {encrypted
              ? 'Cannot be turned off later. The site\'s bots cannot read or post in an encrypted room.'
              : 'Not encrypted. It can be switched on later; it can never be switched off once it is.'}
          </div>
        </fieldset>

        {error && (
          <div className="tc-modal-error" style={{ marginBottom: 10 }}>
            {error}
          </div>
        )}

        {orphanNotice && (
          <div className="tc-modal-notice" style={{ marginBottom: 10 }} role="status">
            {orphanNotice}
          </div>
        )}

        <div className="tc-modal-actions">
          <button type="button" className="tc-pill" onClick={close} disabled={busy}>
            {orphanNotice ? 'Done' : 'Cancel'}
          </button>
          {!orphanNotice && (
            <button
              type="button"
              className="tc-pill"
              data-tone="go"
              onClick={() => void submit()}
              disabled={busy || !name.trim()}
            >
              {busy ? 'Creating...' : 'Create'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function TypeBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className="tc-pill"
      onClick={onClick}
      aria-pressed={active}
      style={{ flex: 1 }}
    >
      {children}
    </button>
  )
}
