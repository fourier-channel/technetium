import { useCallback, useEffect, useState } from 'react'

// ---------------------------------------------------------------------------
// Local domain-mode settings (v1: localStorage): per-room backdrop image and
// per-user avatar override (an emoji shown on the puck in domain mode). Local
// so a user can restyle their own canvas without changing the room's real state
// or their global Matrix avatar. Held as a single hook instance in DomainView
// and passed to the canvas + menus.
// ---------------------------------------------------------------------------

const KEY = 'net.41chan.spatial_settings'

interface DomainSettings {
  backdrops: Record<string, string>
  avatars: Record<string, string>
}

function load(): DomainSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { backdrops: {}, avatars: {} }
    const p = JSON.parse(raw) as Partial<DomainSettings>
    return {
      backdrops: p.backdrops && typeof p.backdrops === 'object' ? p.backdrops : {},
      avatars: p.avatars && typeof p.avatars === 'object' ? p.avatars : {},
    }
  } catch {
    return { backdrops: {}, avatars: {} }
  }
}

function save(s: DomainSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // best-effort
  }
}

export interface DomainSettingsApi {
  getBackdrop: (roomId: string) => string | undefined
  setBackdrop: (roomId: string, url: string) => void
  clearBackdrop: (roomId: string) => void
  getAvatar: (userId: string) => string | undefined
  setAvatar: (userId: string, value: string) => void
  clearAvatar: (userId: string) => void
}

export function useDomainSettings(): DomainSettingsApi {
  const [settings, setSettings] = useState<DomainSettings>(load)
  useEffect(() => save(settings), [settings])

  const setBackdrop = useCallback(
    (roomId: string, url: string) =>
      setSettings((s) => ({ ...s, backdrops: { ...s.backdrops, [roomId]: url } })),
    [],
  )
  const clearBackdrop = useCallback(
    (roomId: string) =>
      setSettings((s) => {
        const backdrops = { ...s.backdrops }
        delete backdrops[roomId]
        return { ...s, backdrops }
      }),
    [],
  )
  const setAvatar = useCallback(
    (userId: string, value: string) =>
      setSettings((s) => ({ ...s, avatars: { ...s.avatars, [userId]: value } })),
    [],
  )
  const clearAvatar = useCallback(
    (userId: string) =>
      setSettings((s) => {
        const avatars = { ...s.avatars }
        delete avatars[userId]
        return { ...s, avatars }
      }),
    [],
  )

  return {
    getBackdrop: (roomId) => settings.backdrops[roomId],
    setBackdrop,
    clearBackdrop,
    getAvatar: (userId) => settings.avatars[userId],
    setAvatar,
    clearAvatar,
  }
}
