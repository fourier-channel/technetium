import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MatrixClient, Room } from 'matrix-js-sdk'
import { initials } from '../client/members'
import {
  isValidMxid,
  mergeCandidates,
  searchDirectory,
  type DirectoryUser,
} from '../client/userDirectory'
import { AuthedImage } from './AuthedImage'

// W3.6 -- pick a user. Shared by invite (W3.7) and start-a-DM (W3.8).
//
// Local members answer instantly; the directory fills in people we have never
// shared a room with; a raw MXID is the escape hatch, because the directory
// only indexes users who share a room or are published, so a perfectly valid
// id can be missing from it entirely.

const DEBOUNCE_MS = 250

export function UserPicker({
  client,
  title,
  actionLabel,
  // Usually the room being invited to: offering someone already in it is noise.
  excludeFromRoom,
  onPick,
  onClose,
}: {
  client: MatrixClient | null
  title: string
  actionLabel: string
  excludeFromRoom?: Room | null
  onPick: (userId: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [directory, setDirectory] = useState<DirectoryUser[]>([])
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const excluded = useMemo(() => {
    const set = new Set<string>()
    const me = client?.getUserId()
    if (me) set.add(me)
    if (excludeFromRoom) {
      for (const m of excludeFromRoom.getJoinedMembers()) set.add(m.userId)
    }
    return set
  }, [client, excludeFromRoom])

  // Local members across every joined room -- the people most likely meant.
  const local = useMemo<DirectoryUser[]>(() => {
    if (!client) return []
    const byId = new Map<string, DirectoryUser>()
    for (const room of client.getRooms()) {
      if (room.getMyMembership() !== 'join') continue
      for (const m of room.getJoinedMembers()) {
        if (byId.has(m.userId)) continue
        byId.set(m.userId, {
          userId: m.userId,
          displayName: m.name,
          avatarMxc: m.getMxcAvatarUrl() ?? undefined,
        })
      }
    }
    const q = query.trim().toLowerCase()
    const all = [...byId.values()]
    if (!q) return all.slice(0, 20)
    return all
      .filter(
        (u) =>
          (u.displayName ?? '').toLowerCase().includes(q) || u.userId.toLowerCase().includes(q),
      )
      .slice(0, 20)
  }, [client, query])

  // Directory lookups are network calls; one per keystroke would hammer the
  // homeserver for a list the user is still typing.
  useEffect(() => {
    if (!client) return
    const term = query.trim()
    let cancelled = false
    // Everything lands from the timeout, never from the effect body -- a
    // synchronous setState in an effect is what G-tc01 forbids. The short-term
    // case still goes through the timer, it just clears instead of searching.
    const timer = setTimeout(() => {
      if (cancelled) return
      if (term.length < 2) {
        setDirectory([])
        setSearching(false)
        return
      }
      setSearching(true)
      void searchDirectory(client, term).then((results) => {
        if (cancelled) return
        setDirectory(results)
        setSearching(false)
      })
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [client, query])

  const candidates = useMemo(
    () => mergeCandidates(local, directory, query, excluded),
    [local, directory, query, excluded],
  )

  const pick = (userId: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      onPick(userId)
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const rawIsValid = isValidMxid(query)
  const rawLooksLikeAttempt = query.trim().startsWith('@')

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
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
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 16,
          borderRadius: 12,
          fontFamily: 'var(--tc-ui-font, inherit)',
          color: 'var(--cpd-color-text-primary)',
          background: 'var(--cpd-color-bg-canvas-default)',
          border: '1px solid rgba(128,128,128,0.35)',
          boxShadow: '0 16px 44px rgba(0,0,0,0.55)',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>{title}</div>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name or @user:server"
          aria-label="Search for a user"
          autoFocus
          style={{
            fontSize: 13,
            padding: '6px 10px',
            marginBottom: 8,
            borderRadius: 8,
            border: '1px solid rgba(128,128,128,0.35)',
            background: 'transparent',
            color: 'inherit',
          }}
        />

        {rawLooksLikeAttempt && !rawIsValid && query.trim().length > 1 && (
          <div style={{ fontSize: 11, color: 'var(--cpd-color-text-secondary)', marginBottom: 6 }}>
            A full user id looks like @name:server.tld
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {candidates.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--cpd-color-text-secondary)', padding: '8px 0' }}>
              {searching ? 'Searching...' : query.trim() ? 'Nobody found.' : 'Start typing a name.'}
            </div>
          ) : (
            candidates.map((u) => (
              <button
                key={u.userId}
                type="button"
                disabled={busy}
                onClick={() => pick(u.userId)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: 'none',
                  background: 'transparent',
                  color: 'inherit',
                  cursor: busy ? 'default' : 'pointer',
                  minWidth: 0,
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = 'var(--cpd-color-bg-subtle-secondary)')
                }
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    flexShrink: 0,
                    borderRadius: '50%',
                    overflow: 'hidden',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#fff',
                    background: 'var(--cpd-color-bg-subtle-primary, #4a5568)',
                  }}
                >
                  {u.avatarMxc ? (
                    <AuthedImage
                      mxc={u.avatarMxc}
                      width={180}
                      fill
                      transparentLoading
                      alt=""
                      fallback={initials(u.displayName || u.userId)}
                      viaHomeserver
                    />
                  ) : (
                    initials(u.displayName || u.userId)
                  )}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 13,
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {u.displayName || u.userId}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 11,
                      color: 'var(--cpd-color-text-secondary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {u.userId}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>

        {error && (
          <div
            style={{
              fontSize: 12,
              marginTop: 8,
              color: 'var(--cpd-color-text-critical-primary, #ff6b6b)',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          <span style={{ fontSize: 11, color: 'var(--cpd-color-text-secondary)' }}>
            {busy ? `${actionLabel}...` : `${candidates.length} match${candidates.length === 1 ? '' : 'es'}`}
          </span>
          <button type="button" onClick={onClose} style={{ fontSize: 13, padding: '5px 12px' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
