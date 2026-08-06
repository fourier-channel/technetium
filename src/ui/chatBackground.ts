import { useCallback, useEffect, useState } from 'react'

// ---------------------------------------------------------------------------
// Per-room chat-window background (local, per-user; v1 localStorage). Each user
// can give a room's chat log a wallpaper -- an uploaded image (mxc, robust via
// the homeserver auth-media path + auto-refresh) or a pasted URL -- with a
// readability dim so message text stays legible. Local, like domain avatar/
// backdrop overrides: it restyles THIS user's view only, never room state.
//
// A portable / shared variant (room account data, or shared room state like the
// domain background) is a deliberate v2; the localStorage key is namespaced to
// make that a move, not a rename.
// ---------------------------------------------------------------------------

const KEY = 'net.41chan.chat_background'

export interface ChatBg {
  // Exactly one of mxc / url is set. mxc is preferred (auto-refresh + auth path).
  mxc?: string
  url?: string
  // Darkening scrim over the image, 0..0.9, so text stays readable. Default 0.45.
  dim: number
}

type Store = Record<string, ChatBg>

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const p: unknown = JSON.parse(raw)
    return p && typeof p === 'object' ? (p as Store) : {}
  } catch {
    return {}
  }
}

function persist(s: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // best-effort
  }
}

export interface ChatBackgroundApi {
  get: (roomId: string) => ChatBg | undefined
  set: (roomId: string, bg: ChatBg) => void
  clear: (roomId: string) => void
}

export function useChatBackground(): ChatBackgroundApi {
  const [store, setStore] = useState<Store>(load)
  useEffect(() => persist(store), [store])

  const set = useCallback(
    (roomId: string, bg: ChatBg) => setStore((s) => ({ ...s, [roomId]: bg })),
    [],
  )
  const clear = useCallback(
    (roomId: string) =>
      setStore((s) => {
        const next = { ...s }
        delete next[roomId]
        return next
      }),
    [],
  )

  return {
    get: (roomId) => store[roomId],
    set,
    clear,
  }
}
