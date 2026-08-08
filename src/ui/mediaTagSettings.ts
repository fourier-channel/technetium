import { useCallback, useSyncExternalStore } from 'react'
import { reportIgnored } from '../client/report'
// ---------------------------------------------------------------------------
// Tag-strip visibility: a GLOBAL default with PER-IMAGE overrides (operator's
// call). Strips are on by default; the global switch turns them off everywhere
// at once; an individual image can be pinned open or closed against whatever
// the global says, and that pin survives a reload.
//
// Local per-user, like the chat background (CD-21): what a user wants to look at
// is not room state. The key is namespaced so a portable account-data variant
// stays a move rather than a rename.
// ---------------------------------------------------------------------------

const KEY = 'net.41chan.media_tag_prefs'

type Override = 'show' | 'hide'

interface Prefs {
  // Global default for every image that has no override.
  enabled: boolean
  // mediaId -> pin. Sparse: only images the user explicitly pinned appear.
  overrides: Record<string, Override>
}

const DEFAULTS: Prefs = { enabled: true, overrides: {} }

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const p: unknown = JSON.parse(raw)
    if (!p || typeof p !== 'object') return DEFAULTS
    const o = p as Partial<Prefs>
    return {
      enabled: typeof o.enabled === 'boolean' ? o.enabled : true,
      overrides: o.overrides && typeof o.overrides === 'object' ? o.overrides : {},
    }
  } catch (err) {
    reportIgnored('media tag prefs: read', err)
    return DEFAULTS
  }
}

let prefs: Prefs = load()
const listeners = new Set<() => void>()

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch (err) {
    reportIgnored('media tag prefs: save', err)
  }
}

function set(next: Prefs): void {
  prefs = next
  persist()
  for (const cb of listeners) cb()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function snapshot(): Prefs {
  return prefs
}

export function useMediaTagPrefs() {
  const p = useSyncExternalStore(subscribe, snapshot, snapshot)

  const setEnabled = useCallback((enabled: boolean) => set({ ...prefs, enabled }), [])

  const toggleGlobal = useCallback(() => set({ ...prefs, enabled: !prefs.enabled }), [])

  // Pin one image against the global default. Setting a pin that MATCHES the
  // global clears it instead, so overrides don't accumulate as dead entries.
  const setOverride = useCallback((mediaId: string, override: Override | null) => {
    const overrides = { ...prefs.overrides }
    if (override === null || (override === 'show') === prefs.enabled) {
      delete overrides[mediaId]
    } else {
      overrides[mediaId] = override
    }
    set({ ...prefs, overrides })
  }, [])

  const clearOverrides = useCallback(() => set({ ...prefs, overrides: {} }), [])

  const visibleFor = useCallback(
    (mediaId: string | undefined) => {
      if (!mediaId) return p.enabled
      const o = p.overrides[mediaId]
      return o ? o === 'show' : p.enabled
    },
    [p],
  )

  return {
    enabled: p.enabled,
    overrideCount: Object.keys(p.overrides).length,
    visibleFor,
    setEnabled,
    toggleGlobal,
    setOverride,
    clearOverrides,
  }
}
