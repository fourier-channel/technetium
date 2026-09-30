import { createContext, useContext, useSyncExternalStore } from 'react'
import type { PersonOpener } from './personGesture'

// ---------------------------------------------------------------------------
// Where a person's chat actions and profile preview are hosted, per room
// (launch-polish L23).
//
// The chat actions menu belongs to the room's Timeline: that is where the
// actions are sent from and where they play. The member list and the thread
// panel draw the same people and must offer the same gestures, so each
// Timeline registers its two openers here under its room, and those panels
// ask for the room they are showing. One menu, one card, one hook sending --
// nothing is duplicated to make a second panel work.
//
// Pure apart from the React hook at the bottom, so the check suite drives it.
// ---------------------------------------------------------------------------

export interface PersonOpeners {
  // The chat actions menu (left click).
  act: PersonOpener
  // The profile preview (right click).
  look: PersonOpener
}

export interface PersonRouter {
  // Returns the unregister function. A later registration for the same room
  // wins; unregistering an older one leaves the newer in place.
  register(roomId: string, openers: PersonOpeners): () => void
  get(roomId: string): PersonOpeners | undefined
  subscribe(listener: () => void): () => void
  version(): number
}

export function createPersonRouter(): PersonRouter {
  const byRoom = new Map<string, PersonOpeners>()
  const listeners = new Set<() => void>()
  let v = 0
  const changed = () => {
    v++
    for (const l of listeners) l()
  }
  return {
    register(roomId, openers) {
      byRoom.set(roomId, openers)
      changed()
      return () => {
        if (byRoom.get(roomId) !== openers) return
        byRoom.delete(roomId)
        changed()
      }
    },
    get: (roomId) => byRoom.get(roomId),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    version: () => v,
  }
}

export const PersonRouterContext = createContext<PersonRouter | null>(null)

export function usePersonRouter(): PersonRouter | null {
  return useContext(PersonRouterContext)
}

// The openers for one room, re-read when a Timeline registers or leaves.
export function usePersonOpeners(roomId: string | null | undefined): PersonOpeners | undefined {
  const router = useContext(PersonRouterContext)
  useSyncExternalStore(
    router ? router.subscribe : noSubscribe,
    router ? router.version : zero,
  )
  return router && roomId ? router.get(roomId) : undefined
}

const noSubscribe = () => () => {}
const zero = () => 0
