import { createContext, useContext } from 'react'

// How a row asks for the chat actions menu, mirroring profileOpener (W4.2).
// It is what a LEFT click on a person opens (L23, personGesture.ts).
//
// Through a context rather than a prop: Row is shared by the timeline and the
// thread panel, and the menu has to be owned above BOTH so only one is ever
// open. The timeline owns it; the thread panel provides the timeline's own
// opener for its room (personRouter.ts). A surface with none falls back to the
// profile preview on left click.

export type InteractionOpener = ((userId: string, x: number, y: number) => void) | undefined

export const InteractionTargetContext = createContext<InteractionOpener>(undefined)

export function useInteractionTarget(): InteractionOpener {
  return useContext(InteractionTargetContext)
}
