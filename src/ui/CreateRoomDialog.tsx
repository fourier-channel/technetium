import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MatrixClient } from 'matrix-js-sdk'
import { createRoom, type HouseJoinRule } from '../client/createRoom'

// W3.9 -- minimal create dialog. Name, topic, room-or-space, join rule, and an
// optional parent space.

const JOIN_RULES: { value: HouseJoinRule; label: string; hint: string }[] = [
  { value: 'invite', label: 'Invite only', hint: 'Only people you invite can join.' },
  { value: 'knock', label: 'Ask to join', hint: 'Anyone can request an invite.' },
  { value: 'public', label: 'Public', hint: 'Anyone who knows the address can join.' },
]

export function CreateRoomDialog({
  client,
  onCreated,
  onClose,
}: {
  client: MatrixClient
  onCreated: (roomId: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  const [isSpace, setIsSpace] = useState(false)
  const [joinRule, setJoinRule] = useState<HouseJoinRule>('invite')
  // Default OFF. This is the one setting on this form that cannot be changed
  // afterwards, which is why it defaults to the safe direction and says so.
  const [federate, setFederate] = useState(false)
  const [parentSpaceId, setParentSpaceId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set when the room was created but could not be parented -- the room EXISTS,
  // and the id has to reach the user so it can be adopted by hand.
  const [orphanNotice, setOrphanNotice] = useState<string | null>(null)

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
      onCreated(result.roomId)
    } catch (err) {
      const e = err as { message?: string }
      setError(e?.message ?? 'Could not create it.')
      setBusy(false)
    }
  }

  const field: React.CSSProperties = {
    width: '100%',
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
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
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

        <label style={labelStyle} htmlFor="tc-create-join">
          Who can join
        </label>
        <select
          id="tc-create-join"
          value={joinRule}
          onChange={(e) => setJoinRule(e.target.value as HouseJoinRule)}
          style={field}
        >
          {JOIN_RULES.map((r) => (
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

        {spaces.length > 0 && (
          <>
            <label style={labelStyle} htmlFor="tc-create-parent">
              Put it inside (optional)
            </label>
            <select
              id="tc-create-parent"
              value={parentSpaceId}
              onChange={(e) => setParentSpaceId(e.target.value)}
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
              wordBreak: 'break-all',
            }}
            role="status"
          >
            {orphanNotice}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button type="button" onClick={onClose} style={{ fontSize: 13, padding: '5px 12px' }}>
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
