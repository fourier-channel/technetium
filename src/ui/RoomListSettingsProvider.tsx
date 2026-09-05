import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ClientEvent } from 'matrix-js-sdk'
import { useClient } from '../client/ClientContext'
import { serverMutedRooms, setRoomMutedOnServer } from '../client/pushRules'
import { reportIgnored } from '../client/report'
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
      dmFilter: p.dmFilter === 'favorites' || p.dmFilter === 'all' ? p.dmFilter : 'recent',
    }
  } catch (err) {
    reportIgnored('room list settings: read', err)
    return defaultRoomListSettings()
  }
}

function saveSettings(s: RoomListSettings): void {
  try {
    localStorage.setItem(ROOM_LIST_SETTINGS_KEY, JSON.stringify(s))
  } catch (err) {
    reportIgnored('room list settings: save', err)
  }
}

export function RoomListSettingsProvider({ children }: { children: ReactNode }) {
  const { client } = useClient()
  const [settings, setSettings] = useState<RoomListSettings>(loadSettings)
  // W3.5 -- rooms muted by a SERVER push rule. The source of truth for
  // permanent mutes; the local `mutes` map survives only as a read-fallback
  // for rooms muted before push rules were wired up (O-tp2).
  const [serverMutes, setServerMutes] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (!client) return
    let cancelled = false
    const refresh = () => {
      if (!cancelled) setServerMutes(serverMutedRooms(client))
    }
    queueMicrotask(refresh)
    // Push rules arrive and change as account data.
    const onAccountData = () => refresh()
    client.on(ClientEvent.AccountData, onAccountData)
    return () => {
      cancelled = true
      client.off(ClientEvent.AccountData, onAccountData)
    }
  }, [client])
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
  const setDmFilter = useCallback(
    (f: RoomListSettings['dmFilter']) => setSettings((s) => ({ ...s, dmFilter: f })),
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
    (roomId: string, until: number | null) => {
      if (until === null) {
        // Permanent mute -> the server. Also drop any local entry: this is the
        // migrate-forward moment for a room muted before push rules existed
        // (O-tp2 -- on first toggle-touch, never a silent mass migration).
        setSettings((s) => {
          const mutes = { ...s.mutes }
          delete mutes[roomId]
          return { ...s, mutes }
        })
        if (client) {
          void setRoomMutedOnServer(client, roomId, true).catch((err) =>
            // Report and leave the room unmuted rather than showing it muted
            // on a write that did not land.
            console.error('Server mute failed:', err),
          )
        }
        return
      }
      // A snooze has an expiry; a push rule does not. Local only, by design.
      setSettings((s) => ({ ...s, mutes: { ...s.mutes, [roomId]: until } }))
    },
    [client],
  )
  const clearMute = useCallback(
    (roomId: string) => {
      setSettings((s) => {
        const mutes = { ...s.mutes }
        delete mutes[roomId]
        return { ...s, mutes }
      })
      if (client) {
        void setRoomMutedOnServer(client, roomId, false).catch((err) =>
          console.error('Server unmute failed:', err),
        )
      }
    },
    [client],
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
      dmFilter: settings.dmFilter,
      setDmFilter,
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
        // Server rule first: it is the source of truth and it is what silences
        // the account rather than just this browser.
        if (serverMutes.has(roomId)) return true
        if (!(roomId in settings.mutes)) return false
        const until = settings.mutes[roomId]
        // A legacy local "mute forever" still reads as muted until the user
        // touches the toggle, at which point it migrates to a push rule.
        if (until === null) return true
        return until > Date.now()
      },
      setMute,
      clearMute,
    }),
    [
      settings,
      serverMutes,
      setAnimationsEnabled,
      setSoundEnabled,
      setSoundVolume,
      setPanelWidth,
      setPanelLocked,
      setDmFilter,
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
