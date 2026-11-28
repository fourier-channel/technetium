import { useSyncExternalStore } from 'react'
import { reportIgnored } from '../client/report'
import {
  PROVENANCE_DWELL_KEY,
  PROVENANCE_ON_KEY,
  PROVENANCE_SHEEN_PREVIEW_KEY,
  parseDwell,
  provenanceAvailable,
  provenanceOn,
} from '../client/provenanceMode'

// Provenance mode's three per-browser settings (client/provenanceMode.ts says
// why per browser). One snapshot, one listener set, read through
// useSyncExternalStore so the badge, the layer and the settings block agree
// the moment any of them changes it (the `storage` event fires in OTHER tabs
// only, which is why it is not the mechanism here).

export interface ProvenanceState {
  available: boolean
  on: boolean
  dwellMs: number
  sheenPreview: boolean
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch (err) {
    reportIgnored('provenance mode: read setting', err)
    return null
  }
}

const AVAILABLE = typeof window !== 'undefined' && provenanceAvailable(window.location.hostname, import.meta.env.DEV)

function load(): ProvenanceState {
  if (!AVAILABLE) return { available: false, on: false, dwellMs: parseDwell(null), sheenPreview: false }
  return {
    available: true,
    on: provenanceOn(read(PROVENANCE_ON_KEY)),
    dwellMs: parseDwell(read(PROVENANCE_DWELL_KEY)),
    sheenPreview: provenanceOn(read(PROVENANCE_SHEEN_PREVIEW_KEY)),
  }
}

let snapshot = load()
const listeners = new Set<() => void>()

function write(key: string, value: string | null): boolean {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch (err) {
    reportIgnored('provenance mode: save setting', err)
    return false
  }
  snapshot = load()
  for (const l of listeners) l()
  return true
}

// Each returns false when the browser refused to store it, so the caller can
// say so rather than show a switch that did not switch.
export const setProvenanceOn = (on: boolean) => write(PROVENANCE_ON_KEY, on ? '1' : null)
export const setProvenanceDwell = (ms: number) => write(PROVENANCE_DWELL_KEY, String(ms))
export const setSheenPreview = (on: boolean) => write(PROVENANCE_SHEEN_PREVIEW_KEY, on ? '1' : null)

export function useProvenance(): ProvenanceState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => snapshot,
  )
}
