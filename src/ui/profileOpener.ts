import { createContext, useContext } from 'react'

// W4.2 -- how a message row asks for a profile card.
//
// Through a context rather than a Row prop: Row is shared by the timeline and
// the thread panel, and the card has to be owned above BOTH so only one is
// ever open. An unprovided surface simply has non-clickable sender pills.

export type ProfileOpener = ((userId: string, x: number, y: number) => void) | undefined

export const ProfileOpenerContext = createContext<ProfileOpener>(undefined)

export function useProfileOpener(): ProfileOpener {
  return useContext(ProfileOpenerContext)
}
