import { useEffect, useState } from 'react'
import type { MatrixClient, Room } from 'matrix-js-sdk'
import { search, type SearchOutcome, type SearchScope } from '../client/search'
import { useJump } from './jumpToEvent'

// W5.1 -- the search results panel. Opens from the timeline header.
//
// The local-fallback labelling is the important part: a search that quietly
// covers only loaded messages would answer "not found" with total confidence
// about a room it has barely read.

const DEBOUNCE_MS = 350

export function SearchPanel({
  client,
  room,
  onJumpRoom,
  onClose,
}: {
  client: MatrixClient
  room: Room | null
  // Jumping to a hit in ANOTHER room has to switch rooms first.
  onJumpRoom?: (roomId: string) => void
  onClose: () => void
}) {
  const [term, setTerm] = useState('')
  const [scope, setScope] = useState<SearchScope>('room')
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null)
  const [busy, setBusy] = useState(false)
  const { jump } = useJump()

  useEffect(() => {
    const q = term.trim()
    let cancelled = false
    const timer = setTimeout(() => {
      if (cancelled) return
      if (q.length < 2) {
        setOutcome(null)
        setBusy(false)
        return
      }
      setBusy(true)
      void search(client, q, scope, room?.roomId ?? null).then((res) => {
        if (cancelled) return
        setOutcome(res)
        setBusy(false)
      })
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [client, term, scope, room])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="tc-pinned-panel" role="dialog" aria-label="Search messages">
      <div className="tc-pinned-header">
        <strong>Search</strong>
        <button type="button" onClick={onClose} aria-label="Close search">
          Close
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <input
          type="text"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search messages..."
          aria-label="Search messages"
          autoFocus
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            padding: '5px 8px',
            borderRadius: 6,
            border: '1px solid rgba(128,128,128,0.35)',
            background: 'transparent',
            color: 'inherit',
          }}
        />
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as SearchScope)}
          aria-label="Search scope"
          style={{
            fontSize: 12,
            borderRadius: 6,
            border: '1px solid rgba(128,128,128,0.35)',
            background: 'transparent',
            color: 'inherit',
          }}
        >
          <option value="room">This room</option>
          <option value="all">All rooms</option>
        </select>
      </div>

      {outcome?.source === 'local' && (
        <div
          style={{
            fontSize: 11,
            padding: '4px 8px',
            marginBottom: 6,
            borderRadius: 6,
            background: 'var(--cpd-color-bg-subtle-secondary)',
            color: 'var(--cpd-color-text-secondary)',
          }}
        >
          {outcome.degradedReason} Showing matches from loaded messages only --
          this is not a complete search of the room.
        </div>
      )}

      {busy ? (
        <div className="tc-pinned-empty">Searching...</div>
      ) : !outcome ? (
        <div className="tc-pinned-empty">Type at least two characters.</div>
      ) : outcome.hits.length === 0 ? (
        <div className="tc-pinned-empty">
          No matches{outcome.source === 'local' ? ' in loaded messages' : ''}.
        </div>
      ) : (
        <ul className="tc-pinned-list">
          {outcome.hits.map((hit) => {
            const hitRoom = client.getRoom(hit.roomId)
            const who = hitRoom?.getMember(hit.sender)?.name || hit.sender
            const where = hitRoom?.name || hit.roomId
            return (
              <li key={hit.eventId} className="tc-pinned-item">
                <button
                  type="button"
                  className="tc-pinned-jump"
                  onClick={() => {
                    if (hit.roomId !== room?.roomId) onJumpRoom?.(hit.roomId)
                    onClose()
                    // The jump paginates if the hit is outside the window.
                    void jump(hit.eventId)
                  }}
                  title={`Jump to this message in ${where}`}
                >
                  <span className="tc-pinned-sender">{who}</span>
                  <span className="tc-pinned-preview">{hit.body}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
