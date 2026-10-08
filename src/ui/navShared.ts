import { createContext, useContext } from 'react'
import type { NavTreeState } from '../client/useNavTree'
import type { NotifMap } from '../client/useRoomNotifications'

// The room tree and the per-room counts, held ONCE for the app and read by
// every list that draws rooms or conversations (launch-polish L30).
//
// Both hooks do network work: the tree fetches every space's hierarchy, and
// under sliding sync the counts are polled from a classic /sync. When the
// Direct Messages section moved from the room list to the user list, a
// second copy of either would have doubled that traffic from every open tab
// -- the shape of the minute-poll that was 202k of 246k requests reaching the
// origin on 2026-10-04. App runs them; the lists read this.

export interface NavShared {
  nav: NavTreeState
  notifs: NotifMap
}

const EMPTY: NavShared = { nav: { tree: null, loading: false, stale: false }, notifs: new Map() }

export const NavSharedContext = createContext<NavShared>(EMPTY)

export function useNavShared(): NavShared {
  return useContext(NavSharedContext)
}
