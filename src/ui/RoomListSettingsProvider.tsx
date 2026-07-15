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
      mutes: p.mutes && typeof p.mutes === 'object' ? p.mutes : {},
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
      isFavorite: (roomId) => settings.favorites.includes(roomId),
      toggleFavorite,
      getIcon: (roomId) => settings.icons[roomId],
      setIcon,
      clearIcon,
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
    [settings, setAnimationsEnabled, toggleFavorite, setIcon, clearIcon, setMute, clearMute],
  )

  return <RoomListSettingsContext.Provider value={api}>{children}</RoomListSettingsContext.Provider>
}
