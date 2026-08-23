import { useRef, useState } from 'react'
import type { MatrixClient, Room } from 'matrix-js-sdk'
import { canIgnore, isIgnored, setIgnored } from '../client/ignoredUsers'
import { startDm } from '../client/dm'
import { clearAvatar, setDisplayName, uploadAndSetAvatar } from '../client/profile'
import { describeInviteError } from '../client/userDirectory'
import { AVATAR_SHAPES, useAvatarShape } from './avatarShape'

// W4.2/W4.3/W4.4 -- what fills the shared ProfileCard's `actions` slot.
//
// Own card and someone else's card are different tools: yours edits, theirs
// acts on the relationship. Splitting them here keeps the card itself
// presentational.

export function ProfileActions({
  client,
  userId,
  room,
  onOpenRoom,
  onClose,
}: {
  client: MatrixClient
  userId: string
  room: Room | null
  onOpenRoom?: (roomId: string) => void
  onClose: () => void
}) {
  const isSelf = client.getUserId() === userId
  return isSelf ? (
    <OwnProfileActions client={client} />
  ) : (
    <OtherProfileActions
      client={client}
      userId={userId}
      room={room}
      onOpenRoom={onOpenRoom}
      onClose={onClose}
    />
  )
}

function OwnProfileActions({ client }: { client: MatrixClient }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const saveName = async () => {
    setBusy(true)
    setNotice(null)
    try {
      await setDisplayName(client, draft)
      setEditing(false)
      setNotice('Display name updated.')
    } catch (err) {
      setNotice(describeInviteError(err))
    } finally {
      setBusy(false)
    }
  }

  const pickAvatar = async (file: File) => {
    setBusy(true)
    setNotice(null)
    try {
      // D-bf01: chrome media goes to the HOMESERVER, not the content gateway.
      await uploadAndSetAvatar(client, file)
      setNotice('Avatar updated.')
    } catch (err) {
      setNotice(err instanceof Error ? err.message : describeInviteError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {editing ? (
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveName()
              if (e.key === 'Escape') setEditing(false)
            }}
            aria-label="Display name"
            autoFocus
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              padding: '4px 7px',
              borderRadius: 6,
              border: '1px solid rgba(128,128,128,0.35)',
              background: 'transparent',
              color: 'inherit',
            }}
          />
          <ActionBtn onClick={() => void saveName()} disabled={busy}>
            Save
          </ActionBtn>
        </div>
      ) : (
        <ActionBtn
          onClick={() => {
            setDraft(client.getUser(client.getUserId() ?? '')?.displayName ?? '')
            setEditing(true)
          }}
          disabled={busy}
        >
          Change display name
        </ActionBtn>
      )}

      <ActionBtn onClick={() => fileRef.current?.click()} disabled={busy}>
        {busy ? 'Working...' : 'Change avatar'}
      </ActionBtn>
      <ActionBtn onClick={() => void clearAvatar(client)} disabled={busy}>
        Remove avatar
      </ActionBtn>
      <AvatarShapePicker />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void pickAvatar(file)
        }}
      />

      {notice && <Notice>{notice}</Notice>}
    </>
  )
}

function OtherProfileActions({
  client,
  userId,
  room,
  onOpenRoom,
  onClose,
}: {
  client: MatrixClient
  userId: string
  room: Room | null
  onOpenRoom?: (roomId: string) => void
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // Read once per render from account data -- the source of truth, so this
  // cannot disagree with what the timeline filter is doing.
  const ignored = isIgnored(client, userId)

  const message = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const result = await startDm(client, userId)
      onOpenRoom?.(result.roomId)
      onClose()
    } catch (err) {
      setNotice(describeInviteError(err))
      setBusy(false)
    }
  }

  const toggleIgnore = async () => {
    setBusy(true)
    setNotice(null)
    try {
      await setIgnored(client, userId, !ignored)
      setNotice(ignored ? 'Unblocked.' : 'Blocked. Their messages are hidden everywhere.')
    } catch (err) {
      setNotice(describeInviteError(err))
    } finally {
      setBusy(false)
    }
  }

  const invite = async () => {
    if (!room) return
    setBusy(true)
    setNotice(null)
    try {
      await client.invite(room.roomId, userId)
      setNotice('Invite sent.')
    } catch (err) {
      setNotice(describeInviteError(err))
    } finally {
      setBusy(false)
    }
  }

  const alreadyHere = !!room?.getMember(userId)

  return (
    <>
      <ActionBtn onClick={() => void message()} disabled={busy}>
        Message
      </ActionBtn>
      {room && !alreadyHere && (
        <ActionBtn onClick={() => void invite()} disabled={busy}>
          Invite to this room
        </ActionBtn>
      )}
      {canIgnore(client, userId) && (
        <ActionBtn onClick={() => void toggleIgnore()} disabled={busy} danger={!ignored}>
          {ignored ? 'Unblock' : 'Block'}
        </ActionBtn>
      )}
      {notice && <Notice>{notice}</Notice>}
    </>
  )
}

function ActionBtn({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        textAlign: 'left',
        fontSize: 12,
        padding: '5px 8px',
        borderRadius: 6,
        border: '1px solid rgba(128,128,128,0.28)',
        background: 'transparent',
        color: danger
          ? 'var(--cpd-color-text-critical-primary, #ff6b6b)'
          : 'var(--cpd-color-text-primary)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      style={{
        fontSize: 11,
        color: 'var(--cpd-color-text-secondary)',
        paddingTop: 2,
      }}
    >
      {children}
    </div>
  )
}

// The avatar's mask. Swatches rather than a dropdown: a keyhole and a torn hole
// are not things a word describes usefully, and the swatch IS the shape.
//
// Local-only today (O-in6) and the row says so rather than implying that other
// people can see it -- a customisation that silently only exists on your own
// screen is worse than one that admits it.
function AvatarShapePicker() {
  const { shape, setShape } = useAvatarShape()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 2 }}>
      <div style={{ fontSize: 11, color: 'var(--cpd-color-text-secondary)' }}>
        Avatar shape (only you see this for now)
      </div>
      <div role="radiogroup" aria-label="Avatar shape" style={{ display: 'flex', gap: 6 }}>
        {AVATAR_SHAPES.map((s) => {
          const selected = s.id === shape
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={selected}
              title={s.label}
              aria-label={s.label}
              onClick={() => setShape(s.id)}
              style={{
                width: 30,
                height: 30,
                padding: 2,
                borderRadius: 6,
                border: selected
                  ? '1px solid var(--tc-link)'
                  : '1px solid rgba(128,128,128,0.28)',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: 'block',
                  width: '100%',
                  height: '100%',
                  clipPath: s.clipPath,
                  background: selected
                    ? 'var(--tc-link)'
                    : 'var(--cpd-color-text-secondary, #a8b0bd)',
                }}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
