import { createContext, useContext } from 'react'

// How a row asks for the interaction menu, mirroring profileOpener (W4.2).
//
// Through a context rather than a prop: Row is shared by the timeline and the
// thread panel, and the menu has to be owned above BOTH so only one is ever
// open. A surface that does not provide one simply has no interaction
// right-click, which is the correct behaviour for the thread panel until it
// grows its own overlay to draw into.

export type InteractionOpener = ((userId: string, x: number, y: number) => void) | undefined

export const InteractionTargetContext = createContext<InteractionOpener>(undefined)

export function useInteractionTarget(): InteractionOpener {
  return useContext(InteractionTargetContext)
}
