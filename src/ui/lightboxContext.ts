import { createContext, useContext } from 'react'

// The lightbox context, its types, and the hook that reads it.
//
// Split out of Lightbox.tsx so that file exports ONLY its component: a module
// mixing components with other exports cannot be hot-reloaded, so every edit
// to the viewer was forcing a full page reload.

export interface LightboxItem {
  mxc: string
  /** The room this image was rendered from. Needed for ENCRYPTED rooms, where
   *  the server cannot see which room an mxc belongs to. */
  roomId?: string
  name?: string
  mimetype?: string
}

// The conversation the open image came from, supplying the VERTICAL axis:
// every image-bearing message in it, in timeline order, as a list of stops (a
// lone image is a one-item stop, a gallery batch is one stop of N). Built by
// the surface that rendered the messages -- see mediaSequence.ts -- because the
// viewer is mounted at App root and has no idea what the reader is reading.
export interface LightboxThread {
  stops: LightboxItem[][]
  /** Which stop the opened set is. */
  stop: number
}

export interface LightboxApi {
  // Open the viewer on a set of images at startIndex (clamped). A one-element
  // set shows no horizontal navigation. Pass `thread` to give up/down a
  // conversation to walk; without it the viewer has no vertical axis.
  open: (items: LightboxItem[], startIndex?: number, thread?: LightboxThread) => void
}

export const LightboxContext = createContext<LightboxApi | null>(null)

// Hook for any descendant of LightboxProvider to open the viewer.
export function useLightbox(): LightboxApi {
  const ctx = useContext(LightboxContext)
  if (!ctx) throw new Error('useLightbox must be used within a LightboxProvider')
  return ctx
}
