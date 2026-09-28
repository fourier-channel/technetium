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

  const field: React.CSSProperties = {
    width: '100%',
    // Without it the padding and border are added OUTSIDE the 100%, and the
    // text inputs stick out past the selects' right edge.
    boxSizing: 'border-box',
    fontSize: 13,
    padding: '6px 10px',
    borderRadius: 8,
    border: '1px solid rgba(128,128,128,0.35)',
    background: 'transparent',
    color: 'inherit',
    marginBottom: 10,
  }

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
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(0,0,0,0.5)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 400,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: '80vh',
          overflowY: 'auto',
          padding: 18,
          borderRadius: 12,
          fontFamily: 'var(--tc-ui-font, inherit)',
          color: 'var(--cpd-color-text-primary)',
          background: 'var(--cpd-color-bg-canvas-default)',
          border: '1px solid rgba(128,128,128,0.35)',
          boxShadow: '0 16px 44px rgba(0,0,0,0.55)',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>
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

          <label style={labelStyle} htmlFor="tc-create-name">
            Name
          </label>
          <input
            id="tc-create-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            style={field}
          />

          <label style={labelStyle} htmlFor="tc-create-topic">
            Topic (optional)
          </label>
          <input
            id="tc-create-topic"
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            style={field}
          />

          {spaces.length > 0 && (
            <>
              <label style={labelStyle} htmlFor="tc-create-parent">
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
                style={field}
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

          <label style={labelStyle} htmlFor="tc-create-join">
            Who can join
          </label>
          <select
            id="tc-create-join"
            value={joinRule}
            onChange={(e) => {
              setJoinRule(e.target.value as HouseJoinRule)
              setJoinPicked(true)
            }}
            style={field}
          >
            {JOIN_RULES.filter((r) => r.value !== 'restricted' || parentSpaceId).map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <div style={{ fontSize: 11, color: 'var(--cpd-color-text-secondary)', marginTop: -6, marginBottom: 10 }}>
            {JOIN_RULES.find((r) => r.value === joinRule)?.hint}
          </div>

          <label style={labelStyle} htmlFor="tc-create-federate">
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
          <div
            style={{
              fontSize: 11,
              lineHeight: 1.5,
              color: federate
                ? 'var(--cpd-color-text-critical-primary, #ff6b6b)'
                : 'var(--cpd-color-text-secondary)',
              marginBottom: 12,
            }}
          >
            {federate
              ? 'Cannot be undone later. Every server a member joins from receives a permanent copy of everything posted here, and can fetch any image it has seen.'
              : 'This ' +
                (isSpace ? 'space' : 'room') +
                ' will exist only on this server. Permanent either way -- this cannot be changed after creation.'}
          </div>

          <label style={labelStyle} htmlFor="tc-create-encrypted">
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
          <div
            style={{
              fontSize: 11,
              lineHeight: 1.5,
              color: encrypted
                ? 'var(--cpd-color-text-critical-primary, #ff6b6b)'
                : 'var(--cpd-color-text-secondary)',
              marginBottom: 12,
            }}
          >
            {encrypted
              ? 'Cannot be turned off later. The site\'s bots cannot read or post in an encrypted room.'
              : 'Not encrypted. It can be switched on later; it can never be switched off once it is.'}
          </div>
        </fieldset>

        {error && (
          <div style={{ fontSize: 12, marginBottom: 10, color: 'var(--cpd-color-text-critical-primary, #ff6b6b)' }}>
            {error}
          </div>
        )}

        {orphanNotice && (
          <div
            style={{
              fontSize: 12,
              marginBottom: 10,
              padding: '8px 10px',
              borderRadius: 6,
              background: 'var(--cpd-color-bg-subtle-secondary)',
              color: 'var(--cpd-color-text-primary)',
              // Breaks only what does not fit -- the room id -- not ordinary words.
              overflowWrap: 'anywhere',
            }}
            role="status"
          >
            {orphanNotice}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button type="button" onClick={close} disabled={busy} style={{ fontSize: 13, padding: '5px 12px' }}>
            {orphanNotice ? 'Done' : 'Cancel'}
          </button>
          {!orphanNotice && (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || !name.trim()}
              style={{ fontSize: 13, padding: '5px 12px', fontWeight: 600 }}
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

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--cpd-color-text-secondary)',
  marginBottom: 4,
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
      onClick={onClick}
      aria-pressed={active}
      style={{
        flex: 1,
        fontSize: 12,
        padding: '5px 10px',
        borderRadius: 8,
        border: '1px solid rgba(128,128,128,0.35)',
        background: active ? 'var(--cpd-color-bg-subtle-secondary)' : 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  )
}
