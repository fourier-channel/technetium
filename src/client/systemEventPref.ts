import { useCallback, useSyncExternalStore } from 'react'
import { reportIgnored } from './report'

// Whether to show system events in the log (isSystemEvent). Off by default:
// they render as a literal `[type]` row that costs height, splits a sender
// cluster and says nothing.
//
// A store rather than the useState+storage-event idiom next door, because that
// one only hears the `storage` event -- which fires in OTHER tabs, not the one
// doing the writing. A toggle in a settings panel has to update the timeline
// behind it in the same tab, which is exactly the case that idiom misses.

const KEY = 'net.41chan.show_system_events'

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch (err) {
    reportIgnored('system events pref: read', err)
    return false
  }
}

let current = load()
const listeners = new Set<() => void>()

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function snapshot(): boolean {
  return current
}

export function useShowSystemEvents(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

// For the settings panel when it exists. Exported now so the preference has one
// owner from the start rather than a second writer bolted on later.
export function useSystemEventToggle(): { enabled: boolean; toggle: () => void } {
  const enabled = useSyncExternalStore(subscribe, snapshot, snapshot)
  const toggle = useCallback(() => {
    current = !current
    try {
      localStorage.setItem(KEY, current ? 'on' : 'off')
    } catch (err) {
      reportIgnored('system events pref: save', err)
    }
    for (const cb of listeners) cb()
  }, [])
  return { enabled, toggle }
}
