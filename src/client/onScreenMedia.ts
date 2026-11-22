// ---------------------------------------------------------------------------
// THE PICTURES ON SCREEN NOW, so they can be asked about again when the
// reader comes back from somewhere a post could have changed.
//
// A picture's live read (useMediaTags refreshBooruTags) runs when its tag
// line scrolls into view, and when a Matrix tags push names it. A post jailed,
// deleted or retagged in the booru sends no push, so a picture that never
// LEAVES the screen is never asked again -- and the thread panel is exactly
// that: it stays mounted while the booru view replaces the room timeline
// beside it. On 2026-11-22 the operator jailed post 2246210 in the booru view
// and came back to its thread: the room's own pictures remounted, read again
// and popped; the thread's stayed, because nothing asked about them.
//
// So every tag line counts itself in here while it is on screen, and the two
// moments a post can have changed under a reader who was looking elsewhere --
// leaving the booru view, and coming back to the window -- ask about each of
// them again. Counted, not a set: the same picture can be on screen twice at
// once (the room timeline and its thread), and the one leaving the screen
// must not take the other with it.
// ---------------------------------------------------------------------------

const onScreen = new Map<string, number>()

/** This picture's tag line is on screen. Call the returned function when it leaves. */
export function lineOnScreen(mediaId: string): () => void {
  onScreen.set(mediaId, (onScreen.get(mediaId) ?? 0) + 1)
  let left = false
  return () => {
    if (left) return
    left = true
    const n = (onScreen.get(mediaId) ?? 0) - 1
    if (n > 0) onScreen.set(mediaId, n)
    else onScreen.delete(mediaId)
  }
}

/** Every picture with a tag line on screen now, once each. */
export function mediaOnScreen(): string[] {
  return [...onScreen.keys()]
}
