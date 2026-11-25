// ---------------------------------------------------------------------------
// Which rooms just earned a chime (tc.91) -- the pure half.
//
// Two transitions count, and nothing else does:
//
//   highlight -- the room's highlight count ROSE. Every mention is its own ping.
//   unread    -- the room went from nothing unread to something unread. A room
//                that is already waiting says so once, not once per message:
//                chiming on every rise would be a chime storm in a busy room,
//                and chiming on highlights alone would leave a direct message
//                silent, because the default push rules notify for one without
//                highlighting it.
//
// Never for a room muted or snoozed right now, and never for a room the user is
// looking at. "Looking at" is the rule useReadMarker already uses to mark a
// room read -- shown, in a visible tab -- so a room cannot be both left unread
// because nobody saw it and silent because somebody did.
//
// The caller advances its previous map on EVERY change, silent or not. A rise
// that was silent (muted, on screen, sound off) is spent; it never sounds later
// when the mute lifts or the toggle is turned on.
//
// Free of VALUE imports so the check suite can load it (O-tp9).
// ---------------------------------------------------------------------------

import type { NotifMap } from './notificationCounts'

export type ChimeKind = 'highlight' | 'unread'

export interface Chime {
  roomId: string
  kind: ChimeKind
}

export interface ChimeContext {
  isMutedNow: (roomId: string) => boolean
  lookingAt: ReadonlySet<string>
}

// The rooms on screen, by useReadMarker's rule: a hidden tab shows nothing, and
// a conversation in a closed dock is not being read.
export function roomsLookedAt(
  tabVisible: boolean,
  selectedRoomId: string | null,
  dockRoomId: string | null,
  dockOpen: boolean,
): Set<string> {
  const out = new Set<string>()
  if (!tabVisible) return out
  if (selectedRoomId) out.add(selectedRoomId)
  if (dockRoomId && dockOpen) out.add(dockRoomId)
  return out
}

// `prev` null = no counts had arrived yet. Whatever was already waiting when
// the client opened is not news, so the first answer is a baseline and silent.
export function decideChimes(prev: NotifMap | null, next: NotifMap, ctx: ChimeContext): Chime[] {
  if (prev === null || prev === next) return []
  const out: Chime[] = []
  for (const [roomId, now] of next) {
    const was = prev.get(roomId)
    const kind: ChimeKind | null =
      now.highlight > (was?.highlight ?? 0)
        ? 'highlight'
        : now.total > 0 && (was?.total ?? 0) === 0
          ? 'unread'
          : null
    if (kind === null) continue
    if (ctx.lookingAt.has(roomId) || ctx.isMutedNow(roomId)) continue
    out.push({ roomId, kind })
  }
  return out
}

// One sound per change of counts, however many rooms moved in it: coming back
// to a tab can find ten rooms risen at once, and ten chimes on one instant is a
// louder chime, not ten of them. A mention outranks an unread.
export function loudestChime(chimes: readonly Chime[]): ChimeKind | null {
  if (chimes.length === 0) return null
  return chimes.some((c) => c.kind === 'highlight') ? 'highlight' : 'unread'
}
