import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// S4 -- shared read-receipt machinery.
//
// Lifted out of useReadMarker so the "mark as read" room-context-menu action
// (Wave 3) sends receipts by exactly the same rules as the auto-marker. Two
// implementations of "which event counts as read" would drift, and the drift
// would show up as rooms that will not clear.
//
// Pure of React: takes a Room, returns an event.
// ---------------------------------------------------------------------------

// Walk back to the latest event that is safe to receipt.
//
// Local echoes (status set, or a `~`-prefixed transaction id) 400 the receipt
// endpoint, and our own spatial presence events are not "read" targets, so
// both are skipped.
export function findReceiptableEvent(room: Room): MatrixEvent | null {
  const events = room.getLiveTimeline().getEvents()
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (ev.status) continue // sending / not_sent local echo
    const eid = ev.getId()
    if (!eid || eid.startsWith('~')) continue
    if (ev.getType().startsWith('net.41chan.spatial.')) continue
    return ev
  }
  return null
}

export interface MarkReadResult {
  // The event a receipt was sent for, or null if there was nothing to send.
  sentFor: string | null
  // True when the room was already read up to that event.
  alreadyRead: boolean
}

// Send an unthreaded m.read receipt for the room's latest receiptable event.
//
// `lastSentId` lets a caller suppress a repeat send for an event it already
// receipted; pass undefined to always send. unthreaded=true clears the room's
// overall unread regardless of thread.
export async function markRoomRead(
  client: MatrixClient,
  room: Room,
  lastSentId?: string | null,
): Promise<MarkReadResult> {
  const target = findReceiptableEvent(room)
  const id = target?.getId()
  if (!target || !id) return { sentFor: null, alreadyRead: false }
  if (lastSentId !== undefined && id === lastSentId) {
    return { sentFor: id, alreadyRead: true }
  }
  // receiptType defaults to m.read.
  await client.sendReadReceipt(target, undefined, true)
  return { sentFor: id, alreadyRead: false }
}
