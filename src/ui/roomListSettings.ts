import { createContext, useContext } from 'react'

// ---------------------------------------------------------------------------
// Room-list preferences (v1: localStorage). Context + hook + types live here
// (no component export) so fast-refresh stays happy; the provider component is
// in RoomListSettingsProvider.tsx.
//
// Holds the client-local room-list state the right-click menu and settings
// toggles drive:
//   - animationsEnabled : master switch for pulses/glows/collapse animation.
//   - favorites         : roomIds kept visible when their category is collapsed.
//   - icons             : per-room emoji/glyph override shown left of the name.
//   - mutes             : per-room notification mute. `null` = muted until
//     un-muted (boolean toggle); a timestamp = snooze until then; absent = active.
//
// Favorites/mute are LOCAL for v1 (portable m.favourite tag / push-rule
// integration are deferred lifts, same local->portable path as thread order).
// ---------------------------------------------------------------------------

export const ROOM_LIST_SETTINGS_KEY = 'net.41chan.room_list_settings'

export interface RoomListSettings {
  animationsEnabled: boolean
  favorites: string[]
  icons: Record<string, string>
  // W3.3 -- LOCAL display-only room name overrides. Deliberately not written
  // to room state: renaming a room for everyone is a moderator action, and
  // this is "call it what I like in my own client".
  renames: Record<string, string>
  // W3.4 -- custom sibling order, keyed by PARENT scope. '' is the root/orphan
  // list. Ids not present fall back to the server order (O-tp5: local for v1,
  // account-data portability is v2, same path as thread order).
  roomOrder: Record<string, string[]>
  mutes: Record<string, number | null>
  soundEnabled: boolean
  soundVolume: number // 0..100
  panelWidth: number | null // px; null = use the computed default
  panelLocked: boolean
  // The DM strip's listing mode, cycled from its header pill.
  dmFilter: DmFilter
}

export type DmFilter = 'recent' | 'favorites' | 'all'

// The cycle order the header pill walks: Recent -> Favorites Only -> All.
export function nextDmFilter(f: DmFilter): DmFilter {
  return f === 'recent' ? 'favorites' : f === 'favorites' ? 'all' : 'recent'
}

export function defaultRoomListSettings(): RoomListSettings {
  return {
    animationsEnabled: true,
    favorites: [],
    icons: {},
    renames: {},
    roomOrder: {},
    mutes: {},
    soundEnabled: false,
    soundVolume: 5,
    panelWidth: null,
    panelLocked: false,
    dmFilter: 'recent',
  }
}

export interface RoomListSettingsApi {
  animationsEnabled: boolean
  setAnimationsEnabled: (on: boolean) => void
  soundEnabled: boolean
  setSoundEnabled: (on: boolean) => void
  soundVolume: number
  setSoundVolume: (v: number) => void
  panelWidth: number | null
  setPanelWidth: (w: number | null) => void
  panelLocked: boolean
  setPanelLocked: (locked: boolean) => void
  dmFilter: DmFilter
  setDmFilter: (f: DmFilter) => void
  isFavorite: (roomId: string) => boolean
  toggleFavorite: (roomId: string) => void
  getIcon: (roomId: string) => string | undefined
  setIcon: (roomId: string, icon: string) => void
  clearIcon: (roomId: string) => void
  // undefined = use the server name.
  getRename: (roomId: string) => string | undefined
  setRename: (roomId: string, name: string) => void
  clearRename: (roomId: string) => void
  getRoomOrder: (scopeKey: string) => string[] | undefined
  setRoomOrder: (scopeKey: string, ids: string[]) => void
  // undefined = active; null = muted indefinitely; number = snooze-until ts.
  getMute: (roomId: string) => number | null | undefined
  isMutedNow: (roomId: string) => boolean
  setMute: (roomId: string, until: number | null) => void
  clearMute: (roomId: string) => void
}

export const RoomListSettingsContext = createContext<RoomListSettingsApi | null>(null)

export function useRoomListSettings(): RoomListSettingsApi {
  const v = useContext(RoomListSettingsContext)
  if (!v) throw new Error('useRoomListSettings must be used within RoomListSettingsProvider')
  return v
}
