import { createContext, useContext } from 'react'

// W2.5 -- which message currently has the emoji picker open, if any.
//
// Two affordances open the same picker: the action bar's React verb and the
// reactions strip's own "+". Keeping the open state per-component would let
// both open at once, so it is owned above them and keyed by event id -- which
// also guarantees only one picker is open across the whole timeline.

export interface ReactTargetApi {
  target: string | null
  setTarget: (eventId: string | null) => void
}

const INERT: ReactTargetApi = { target: null, setTarget: () => {} }

export const ReactTargetContext = createContext<ReactTargetApi>(INERT)

export function useReactTarget(): ReactTargetApi {
  return useContext(ReactTargetContext)
}
