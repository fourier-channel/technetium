import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ROOM_LIST_SETTINGS_KEY,
  RoomListSettingsContext,
  defaultRoomListSettings,
  type RoomListSettings,
  type RoomListSettingsApi,
} from './roomListSettings'

function loadSettings(): RoomListSettings {
  try {
    const raw = localStorage.getItem(ROOM_LIST_SETTINGS_KEY)
    if (!raw) return defaultRoomListSettings()
    const p = JSON.parse(raw) as Partial<RoomListSettings>
    return {
      animationsEnabled: typeof p.animationsEnabled === 'boolean' ? p.animationsEnabled : true,
      favorites: Array.isArray(p.favorites) ? p.favorites.filter((x) => typeof x === 'string') : [],
      icons: p.icons && typeof p.icons === 'object' ? p.icons : {},
      renames: p.renames && typeof p.renames === 'object' ? p.renames : {},
      roomOrder: p.roomOrder && typeof p.roomOrder === 'object' ? p.roomOrder : {},
      mutes: p.mutes && typeof p.mutes === 'object' ? p.mutes : {},
      soundEnabled: p.soundEnabled === true,
      soundVolume: typeof p.soundVolume === 'number' ? Math.max(0, Math.min(100, p.soundVolume)) : 5,
      panelWidth: typeof p.panelWidth === 'number' ? p.panelWidth : null,
      panelLocked: p.panelLocked === true,
    }
  } catch {
    return defaultRoomListSettings()
  }
}

function saveSettings(s: RoomListSettings): void {
  try {
    localStorage.setItem(ROOM_LIST_SETTINGS_KEY, JSON.stringify(s))
  } catch {
    // storage unavailable -- best-effort in v1
  }
}

export function RoomListSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<RoomListSettings>(loadSettings)
  // Persist on change (external-system sync -- not a setState-in-effect).
  useEffect(() => saveSettings(settings), [settings])

  const setAnimationsEnabled = useCallback(
    (on: boolean) => setSettings((s) => ({ ...s, animationsEnabled: on })),
    [],
  )
  const setSoundEnabled = useCallback(
    (on: boolean) => setSettings((s) => ({ ...s, soundEnabled: on })),
    [],
  )
  const setSoundVolume = useCallback(
    (v: number) => setSettings((s) => ({ ...s, soundVolume: Math.max(0, Math.min(100, Math.round(v))) })),
    [],
  )
  const setPanelWidth = useCallback(
    (w: number | null) => setSettings((s) => ({ ...s, panelWidth: w })),
    [],
  )
  const setPanelLocked = useCallback(
    (locked: boolean) => setSettings((s) => ({ ...s, panelLocked: locked })),
    [],
  )
  const toggleFavorite = useCallback(
    (roomId: string) =>
      setSettings((s) => {
        const has = s.favorites.includes(roomId)
        return {
          ...s,
          favorites: has ? s.favorites.filter((id) => id !== roomId) : [...s.favorites, roomId],
        }
      }),
    [],
  )
  const setIcon = useCallback(
    (roomId: string, icon: string) =>
      setSettings((s) => ({ ...s, icons: { ...s.icons, [roomId]: icon } })),
    [],
  )
  const clearIcon = useCallback(
    (roomId: string) =>
      setSettings((s) => {
        const icons = { ...s.icons }
        delete icons[roomId]
        return { ...s, icons }
      }),
    [],
  )

  const setRename = useCallback((roomId: string, name: string) => {
    const trimmed = name.trim()
    setSettings((s) => {
      // An empty override is a removal, not an empty name -- otherwise a room
      // could be renamed to nothing and become unfindable in the nav.
      const renames = { ...s.renames }
      if (trimmed) renames[roomId] = trimmed
      else delete renames[roomId]
      return { ...s, renames }
    })
  }, [])
  const clearRename = useCallback((roomId: string) => {
    setSettings((s) => {
      const renames = { ...s.renames }
      delete renames[roomId]
      return { ...s, renames }
    })
  }, [])
  const setRoomOrder = useCallback((scopeKey: string, ids: string[]) => {
    setSettings((s) => ({ ...s, roomOrder: { ...s.roomOrder, [scopeKey]: ids } }))
  }, [])
  const setMute = useCallback(
    (roomId: string, until: number | null) =>
      setSettings((s) => ({ ...s, mutes: { ...s.mutes, [roomId]: until } })),
    [],
  )
  const clearMute = useCallback(
    (roomId: string) =>
      setSettings((s) => {
        const mutes = { ...s.mutes }
        delete mutes[roomId]
        return { ...s, mutes }
      }),
    [],
  )

  const api = useMemo<RoomListSettingsApi>(
    () => ({
      animationsEnabled: settings.animationsEnabled,
      setAnimationsEnabled,
      soundEnabled: settings.soundEnabled,
      setSoundEnabled,
      soundVolume: settings.soundVolume,
      setSoundVolume,
      panelWidth: settings.panelWidth,
      setPanelWidth,
      panelLocked: settings.panelLocked,
      setPanelLocked,
      isFavorite: (roomId) => settings.favorites.includes(roomId),
      toggleFavorite,
      getIcon: (roomId) => settings.icons[roomId],
      setIcon,
      clearIcon,
      getRename: (roomId) => settings.renames[roomId],
      setRename,
      clearRename,
      getRoomOrder: (scopeKey) => settings.roomOrder[scopeKey],
      setRoomOrder,
      getMute: (roomId) => (roomId in settings.mutes ? settings.mutes[roomId] : undefined),
      isMutedNow: (roomId) => {
        if (!(roomId in settings.mutes)) return false
        const until = settings.mutes[roomId]
        if (until === null) return true
        return until > Date.now()
      },
      setMute,
      clearMute,
    }),
    [
      settings,
      setAnimationsEnabled,
      setSoundEnabled,
      setSoundVolume,
      setPanelWidth,
      setPanelLocked,
      toggleFavorite,
      setIcon,
      clearIcon,
      setRename,
      clearRename,
      setRoomOrder,
      setMute,
      clearMute,
    ],
  )

  return <RoomListSettingsContext.Provider value={api}>{children}</RoomListSettingsContext.Provider>
}
