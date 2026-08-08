import { useCallback, useEffect, useRef, useState } from 'react'
import { RoomMemberEvent, type MatrixClient, type Room, type RoomMember } from 'matrix-js-sdk'
import { reportIgnored } from './report'

// ---------------------------------------------------------------------------
// W2.L4 -- typing indicators.
//
// Reading: the sdk maintains `RoomMember.typing`, so a typing event is just a
// cue to re-read the roster rather than something to accumulate ourselves.
// That avoids having to expire stale entries by hand -- the sdk already does
// it when a typing timeout lapses.
//
// Writing: `sendTyping` is a network call per keystroke if you let it be. The
// sender below sends at most one "typing" per REFRESH_MS while someone keeps
// typing, and one "stopped" when they stop -- which is the whole protocol.
// ---------------------------------------------------------------------------

// How long we tell the server a typing notice is good for. The sdk and other
// clients treat this as an expiry, so it must exceed REFRESH_MS.
const TYPING_TIMEOUT_MS = 8_000

// Minimum gap between repeat "still typing" sends.
const REFRESH_MS = 5_000

// Idle gap after which we proactively send "stopped".
const IDLE_MS = 5_000

// Who is typing in this room right now, excluding the local user.
export function useTypingMembers(client: MatrixClient | null, room: Room | null): RoomMember[] {
  const [typing, setTyping] = useState<RoomMember[]>([])

  useEffect(() => {
    if (!client || !room) {
      queueMicrotask(() => setTyping([]))
      return
    }
    let cancelled = false
    const myUserId = client.getUserId()

    const rebuild = () => {
      if (cancelled) return
      setTyping(room.getJoinedMembers().filter((m) => m.typing && m.userId !== myUserId))
    }

    queueMicrotask(rebuild)

    const onTyping = (_ev: unknown, member: RoomMember) => {
      if (member.roomId === room.roomId) rebuild()
    }
    client.on(RoomMemberEvent.Typing, onTyping)
    return () => {
      cancelled = true
      client.off(RoomMemberEvent.Typing, onTyping)
    }
  }, [client, room])

  return typing
}

// Returns a function the composer calls as the user types. Cheap to call on
// every keystroke -- the throttling is in here, not at the call site.
export function useTypingSender(client: MatrixClient | null, roomId: string | null) {
  // Refs, not state: none of this should re-render the composer, and a
  // keystroke-driven setState would re-render it on every character.
  const lastSentAt = useRef(0)
  const isTyping = useRef(false)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stop = useCallback(() => {
    if (idleTimer.current !== null) {
      clearTimeout(idleTimer.current)
      idleTimer.current = null
    }
    if (!isTyping.current) return
    isTyping.current = false
    lastSentAt.current = 0
    if (client && roomId) {
      void client
        .sendTyping(roomId, false, 0)
        .catch((err) => reportIgnored('typing: stop', err))
    }
  }, [client, roomId])

  const notify = useCallback(
    (active: boolean) => {
      if (!client || !roomId) return
      if (!active) {
        stop()
        return
      }
      const now = Date.now()
      if (!isTyping.current || now - lastSentAt.current > REFRESH_MS) {
        isTyping.current = true
        lastSentAt.current = now
        void client
          .sendTyping(roomId, true, TYPING_TIMEOUT_MS)
          .catch((err) => reportIgnored('typing: start', err))
      }
      // Stopping typing is not an event the composer can observe, so it is
      // inferred from silence.
      if (idleTimer.current !== null) clearTimeout(idleTimer.current)
      idleTimer.current = setTimeout(stop, IDLE_MS)
    },
    [client, roomId, stop],
  )

  // Leaving the room (or unmounting) must retract the notice, or the other
  // side sees "still typing" until the server-side timeout lapses.
  useEffect(() => stop, [stop])

  return { notify, stop }
}
