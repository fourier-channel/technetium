import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MatrixClient, Room } from 'matrix-js-sdk'
import { initials } from '../client/members'
import {
  isValidMxid,
  mergeCandidates,
  searchDirectory,
  type Candidate,
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
  existingDmWith,
  onPick,
  onClose,
}: {
  client: MatrixClient | null
  title: string
  actionLabel: string
  excludeFromRoom?: Room | null
  // Supplied by the start-a-DM caller. Answers, per candidate, whether picking
  // them REOPENS an existing conversation rather than starting a new one --
  // the single most confusing thing about this picker, because W3.8 silently
  // reuses an existing DM and the user could not tell that was going to happen.
  existingDmWith?: (userId: string) => boolean
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
      className="tc-modal-scrim"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="tc-modal"
        style={{ maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="tc-modal-title" style={{ marginBottom: 10 }}>{title}</div>

        <input
          type="text"
          className="tc-input"
          data-wide="true"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name or @user:server"
          aria-label="Search for a user"
          autoFocus
          style={{ marginBottom: 8 }}
        />

        {rawLooksLikeAttempt && !rawIsValid && query.trim().length > 1 && (
          <div className="tc-modal-hint" style={{ marginBottom: 6 }}>
            A full user id looks like @name:server.tld
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {candidates.length === 0 ? (
            <div className="tc-modal-hint" style={{ fontSize: 13, padding: '8px 0' }}>
              {searching ? 'Searching...' : query.trim() ? 'Nobody found.' : 'Start typing a name.'}
            </div>
          ) : (
            candidates.map((u) => (
              <button
                key={u.userId}
                type="button"
                className="tc-modal-row"
                disabled={busy}
                onClick={() => pick(u.userId)}
              >
                <span className="tc-modal-av">
                  {u.avatarMxc ? (
                    <AuthedImage
                      mxc={u.avatarMxc}
                      width={180}
                      fill
                      transparentLoading
                      alt=""
                      fallback={initials(u.displayName || u.userId)}
                    />
                  ) : (
                    initials(u.displayName || u.userId)
                  )}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="tc-modal-name">{u.displayName || u.userId}</span>
                  <span className="tc-modal-sub">{u.userId}</span>
                  <CandidateNote candidate={u} hasDm={!!existingDmWith?.(u.userId)} />
                </span>
              </button>
            ))
          )}
        </div>

        {error && (
          <div className="tc-modal-error" style={{ marginTop: 8 }}>
            {error}
          </div>
        )}

        <div className="tc-modal-actions" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          <span className="tc-modal-hint">
            {busy ? `${actionLabel}...` : `${candidates.length} match${candidates.length === 1 ? '' : 'es'}`}
          </span>
          <button type="button" className="tc-pill" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// What we actually know about this candidate, said plainly.
//
// The picker merges three sources of very different confidence into one list
// (see CandidateSource). Rendered undifferentiated, a well-formed typo looked
// exactly like a real person, and a pick that would REOPEN an existing DM
// looked exactly like one that would start a new one. Both are now stated
// before the click rather than discovered after it.
function CandidateNote({ candidate, hasDm }: { candidate: Candidate; hasDm: boolean }) {
  const bits: { text: string; tone: 'good' | 'warn' | 'plain' }[] = []

  if (hasDm) bits.push({ text: 'opens your existing chat', tone: 'good' })

  if (candidate.source === 'local') {
    bits.push({ text: 'in your rooms', tone: 'good' })
  } else if (candidate.source === 'directory') {
    bits.push({ text: 'found on the directory', tone: 'plain' })
  } else {
    // The important one. A valid SHAPE is not a valid PERSON, and the server
    // will not tell us otherwise until the invite is attempted.
    bits.push({ text: 'typed by you -- not verified to exist', tone: 'warn' })
  }

  return (
    <span style={{ display: 'flex', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
      {bits.map((b) => (
        <span key={b.text} className="tc-picker-note" data-tone={b.tone}>
          {b.text}
        </span>
      ))}
    </span>
  )
}
