import { useCallback, useSyncExternalStore } from 'react'

// ---------------------------------------------------------------------------
// A MATRIX IMAGE FOLLOWS ITS POST, IN ITS ROOMS TOO (operator, 2026-11-11):
// "a sensitive image showing up for a moment and then visibly popping out of
// existence with an animation would be pretty neat. it would show people:
// 'don't post this here.' ... Technetium users get the room cleaned up
// altogether."
//
// The booru says so on the live read (fetchBooruPool answers WITHHELD): the
// image's post is hidden from this reader by a gate other than the rooms --
// sensitive below Gold, deleted, jailed. fourier-auth refuses the same reader
// the image itself from then on, so what is left on screen is a picture that
// will not load again. This store turns that answer into the pop: the image
// is 'popping' for POP_MS, while its row plays the animation, and then
// 'gone', which useTimeline drops from the room like an ignored sender's
// message -- no gap, no placeholder, and the run around it regroups.
//
// For the session only, on purpose: after a reload the picture shows and
// pops again the first time its tags are read, which is the point of it.
// ---------------------------------------------------------------------------

export type PopPhase = 'popping' | 'gone'

// Matches the animation in index.css (.tc-pop): the row is dropped when it
// has finished, by this timer and never by animationend, which a reduced
// motion setting or a row scrolled out of the DOM never fires.
export const POP_MS = 700

const phases = new Map<string, PopPhase>()
// A new object on every change, so it can be a dependency and a snapshot.
let gone: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()

function changed(): void {
  for (const cb of listeners) cb()
}

/** The booru withheld this image's post from the reader: pop it, then drop it. */
export function withhold(mediaId: string, schedule: (run: () => void, ms: number) => unknown = setTimeout): void {
  if (phases.has(mediaId)) return
  phases.set(mediaId, 'popping')
  changed()
  schedule(() => {
    phases.set(mediaId, 'gone')
    gone = new Set([...gone, mediaId])
    changed()
  }, POP_MS)
}

export function popPhase(mediaId: string | undefined): PopPhase | undefined {
  return mediaId ? phases.get(mediaId) : undefined
}

/** Every image whose pop has finished: the rooms no longer show it. */
export function goneMedia(): ReadonlySet<string> {
  return gone
}

export function onWithheld(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** This image's phase, re-rendering only when some image's phase changes. */
export function usePopPhase(mediaId: string | undefined): PopPhase | undefined {
  const get = useCallback(() => popPhase(mediaId), [mediaId])
  return useSyncExternalStore(onWithheld, get, get)
}
