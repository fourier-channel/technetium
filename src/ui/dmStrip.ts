import type { CSSProperties } from 'react'
import type { TreeNode } from '../client/spaces'
import type { NotifCounts, NotifMap } from '../client/notificationCounts'
import type { DmFilter } from './roomListSettings'

// Geometry for the DM strip's faces.
//
// It lives in its own module because the bug it fixes was invisible in place:
// EpicycleReveal's `size` defaulted to 20 while the RoomIcon inside it was
// passed 30, so a face MEASURED 20px and DREW 30px. The button carrying the
// waiting glow took its box from the measurement, which is why the ring came
// out as an oval, why it sat off-centre, and why faces sat at different heights
// depending on whether the reveal animation happened to be playing. Two numbers
// that had to agree were written eight hundred lines apart and did not.
//
// Everything below is derived from ONE avatar size, and the check asserts the
// properties that made the old version wrong: the face is square, the ring is
// inside the box, and the reveal is the same size as the icon it reveals.

// The drawn avatar.
export const DM_AVATAR = 30
// The ring every face wears, avatar or bare initial alike, so the row reads as
// one set rather than pictures floating next to letters.
export const DM_RING = 1
// The button's border-box. Border-box is what makes the ring sit INSIDE the
// tile, so the tile stays square and the glow stays concentric with it.
export const DM_TILE = DM_AVATAR + DM_RING * 2

export interface DmFaceBox {
  width: number
  height: number
  boxSizing: 'border-box'
  borderRadius: '50%'
  // What both the reveal wrapper and the icon must be given. One value, so
  // they cannot disagree again.
  contentSize: number
}

export function dmFaceBox(): DmFaceBox {
  return {
    width: DM_TILE,
    height: DM_TILE,
    boxSizing: 'border-box',
    borderRadius: '50%',
    contentSize: DM_AVATAR,
  }
}

export interface DmFaceState {
  ping: boolean
  unread: boolean
}

// The face's COMPLETE box, exported as data so it can be measured in a real
// layout engine instead of argued about. The whole class of bug here was a box
// that came out a different shape than its author expected, which is not
// something reading the source reliably tells you.
export function dmFaceStyle(state: DmFaceState): CSSProperties {
  return {
    // Fixed square, border-box: the button IS the face's box, so a 50% radius
    // is a circle and never an ellipse, and no flex sibling can stretch it.
    // Without an explicit size a flex item takes its height from its content,
    // and the content differed per face.
    width: DM_TILE,
    height: DM_TILE,
    boxSizing: 'border-box',
    flex: '0 0 auto',
    alignSelf: 'center',
    display: 'grid',
    placeItems: 'center',
    padding: 0,
    // Every face is ringed, avatar or bare initial alike, so the row reads as
    // one set rather than pictures floating beside letters.
    border: `${DM_RING}px solid rgba(128,128,128,0.45)`,
    background: 'transparent',
    cursor: 'pointer',
    lineHeight: 0,
    borderRadius: '50%',
    // Glow, not a badge: at this size there is no room for a counter, and the
    // ring reads at a glance across a wrapped grid of faces. The static ring is
    // the reduced-motion base; .tc-dm-waiting pulses it.
    boxShadow: state.ping
      ? '0 0 0 2px var(--tc-unread), 0 0 12px 2px rgba(255,150,40,0.75)'
      : state.unread
        ? '0 0 0 2px var(--tc-unread-base), 0 0 9px rgba(255,150,40,0.45)'
        : undefined,
  }
}

// True when a face's box can only ever render as a circle: equal sides plus a
// 50% radius. An ellipse is what the operator actually saw, so this is the
// property worth naming.
export function isCircular(box: DmFaceBox): boolean {
  return box.width === box.height && box.borderRadius === '50%'
}

// ---------------------------------------------------------------------------
// Which conversations the Direct Messages section shows. Moved here from
// NavTree.tsx with the section itself (launch-polish L30), and pure, so the
// user list that now holds it and the Members tab that glows for it ask one
// question the same way.
// ---------------------------------------------------------------------------

// A DM's tooltip names the person, since the icon no longer shows a label.
export function dmTitle(node: TreeNode, isDm: boolean, counts: NotifCounts | undefined): string {
  const member = isDm ? node.room?.getAvatarFallbackMember() : undefined
  const who = member?.name || node.name || node.roomId
  if (node.membership === 'invite') return `${who} -- invitation waiting, click to accept`
  if (!counts || counts.total < 1) return who
  const ping = counts.highlight > 0 ? `, ${counts.highlight} ping` : ''
  return `${who} (${counts.total} unread${ping})`
}

// Which orphan rooms the DM strip shows under the current filter. A room
// with a message waiting ALWAYS shows: a filter that can hide the pulse it
// exists to surface would be a mute nobody asked for.
export function dmStripRooms(
  rooms: TreeNode[],
  filter: DmFilter,
  isFavorite: (roomId: string) => boolean,
  notifs: NotifMap,
  isMutedNow: (roomId: string) => boolean,
): TreeNode[] {
  // An invite IS a waiting message -- the server keeps no unread count for a
  // room you have not joined, so membership is the only signal it sends.
  const waiting = (n: TreeNode) =>
    !isMutedNow(n.roomId) &&
    (n.membership === 'invite' || (notifs.get(n.roomId)?.total ?? 0) > 0)
  if (filter === 'all') return rooms
  if (filter === 'favorites') return rooms.filter((n) => isFavorite(n.roomId) || waiting(n))
  // recent: the most recently active dozen, by the room's own clock.
  const ts = (n: TreeNode) => n.room?.getLastActiveTimestamp() ?? 0
  const recent = new Set(
    [...rooms].sort((a, b) => ts(b) - ts(a)).slice(0, 12).map((n) => n.roomId),
  )
  return rooms.filter((n) => recent.has(n.roomId) || waiting(n))
}

// The rows a CLOSED strip still shows. Collapsing tucks away the quiet
// conversations; it must never tuck away the pulse -- same law as the
// filter above, applied to the disclosure itself.
export function dmWaitingRooms(rooms: TreeNode[], notifs: NotifMap, isMutedNow: (roomId: string) => boolean): TreeNode[] {
  return rooms.filter(
    (n) =>
      !isMutedNow(n.roomId) &&
      (n.membership === 'invite' || (notifs.get(n.roomId)?.total ?? 0) > 0),
  )
}
