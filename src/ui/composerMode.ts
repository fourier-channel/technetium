import { createContext, useContext } from 'react'
import type { IContent, MatrixEvent } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// S3 -- composer modes.
//
// The composer is normally a blank slate, but Wave 2's Reply and Edit verbs
// point it at an existing message. That target has to travel from a message
// row to the composer, which are siblings, so it goes through a context rather
// than a prop drilled through Timeline.
//
// Scoping matters: the main composer and the thread panel's composer each get
// their OWN provider, so replying in a thread does not hijack the room
// composer (and vice versa).
//
// Split from ComposerModeProvider.tsx so neither file mixes component and
// non-component exports (react-refresh/only-export-components).
// ---------------------------------------------------------------------------

// Edit carries the EFFECTIVE content (TimelineItem.content, with the winning
// edit already applied). Seeding the composer from target.getContent() would
// depend on whether the sdk happened to aggregate the replacement, so editing
// a message twice could silently revert it to the original text.
export type ComposerMode =
  | { kind: 'normal' }
  | { kind: 'reply'; target: MatrixEvent }
  | { kind: 'edit'; target: MatrixEvent; content: IContent }

export const NORMAL_MODE: ComposerMode = { kind: 'normal' }

export interface ComposerModeApi {
  mode: ComposerMode
  reply: (target: MatrixEvent) => void
  edit: (target: MatrixEvent, content: IContent) => void
  clear: () => void
}

// An unprovided composer is simply always in normal mode. Nothing can set a
// mode without a provider anyway (the action bar lives inside one), so this
// degrades to exactly the pre-S3 behaviour rather than throwing.
const INERT: ComposerModeApi = {
  mode: NORMAL_MODE,
  reply: () => {},
  edit: () => {},
  clear: () => {},
}

export const ComposerModeContext = createContext<ComposerModeApi>(INERT)

export function useComposerMode(): ComposerModeApi {
  return useContext(ComposerModeContext)
}
