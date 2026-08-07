import { useCallback, useEffect, useState } from 'react'

// W5.2 -- per-user opt-in for link previews.
//
// Opt-IN rather than opt-out: asking for a preview makes the HOMESERVER fetch
// a third-party URL on the reader's behalf, and that is a request some people
// would rather never happen without being asked.

const KEY = 'net.41chan.link_previews'

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
}

export function useLinkPreviewPref(): boolean {
  const [on, setOn] = useState(load)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setOn(load())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  return on
}

export function useLinkPreviewToggle(): { enabled: boolean; toggle: () => void } {
  const [on, setOn] = useState(load)
  const toggle = useCallback(() => {
    setOn((prev) => {
      const next = !prev
      try {
        localStorage.setItem(KEY, next ? 'on' : 'off')
      } catch {
        // best-effort
      }
      return next
    })
  }, [])
  return { enabled: on, toggle }
}
