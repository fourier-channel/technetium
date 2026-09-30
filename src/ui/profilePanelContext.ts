import { createContext, useContext } from 'react'

// How anything asks for the Profile panel (L24): the pill under your own card,
// your own profile preview's "Edit your profile". App owns the panel; this is
// the one way to open it, so there is one editor for your profile, not one
// per surface that shows you (D-tc01).
export type ProfilePanelOpener = (() => void) | null

export const ProfilePanelContext = createContext<ProfilePanelOpener>(null)

export function useProfilePanel(): ProfilePanelOpener {
  return useContext(ProfilePanelContext)
}
