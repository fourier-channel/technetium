// What changed since the last render, so a tag can be seen arriving or leaving.
//
// Tags are live: the bridge rewrites an image's tag state when someone retags
// on the booru, and the store already delivers that to one image's panel in
// about a quarter second. What it cannot do is say WHICH tag moved -- the unit
// of change in the store is the whole set -- so a retag lands as a silent swap,
// which is indistinguishable from having missed it.
//
// This is the diff and nothing else. The MOTION is canon (formant
// mod-tag-pop-in / mod-tag-pop-out) so a tag pops identically on every surface.
//
// A LEAVING TAG IS ALREADY GONE FROM THE DATA. To be seen leaving at all it has
// to stay mounted after it stops existing, which is why this returns a render
// list rather than a pair of sets: the caller draws what it is handed and keeps
// no graveyard of its own.
//
// THE RENDER LIST IS STATE, NOT A REF. The obvious shape -- keep the previous
// tags and the entering keys in refs, diff during render -- trips
// react-hooks/refs, which this repo enforces: a ref read during render can
// leave a component not re-rendering when it should. So the effect computes the
// list and stores it, and render only reads state. The one-frame delay that
// costs is not a cost: an entrance animation needs the frame before it anyway.
//
// NOTHING POPS ON FIRST PAINT. The list is seeded steady from the first tags
// seen, so opening a room does not flush thirty pills through an entrance.
import { useEffect, useRef, useState } from 'react'
import type { MediaTag } from './mediaTags'

/** Kept in step with --mod-tag-pop-out-dur in formant tokens.css. */
export const POP_OUT_MS = 160

export type TagPhase = 'steady' | 'entering' | 'leaving'

export interface DiffedTag {
  tag: MediaTag
  phase: TagPhase
}

// Category AND name: the same word in two categories is two tags, and keying on
// the name alone would make a recategorisation look like nothing happened.
export function tagKey(t: MediaTag): string {
  return t.category + ':' + t.name
}

const steady = (tags: MediaTag[]): DiffedTag[] => tags.map((tag) => ({ tag, phase: 'steady' as const }))

/**
 * Build the list to draw: the current tags in their given order, with departing
 * tags reinserted at the index they used to hold so their neighbours do not
 * slide left and then back as the ghost expires.
 */
export function withGhosts(tags: MediaTag[], before: MediaTag[], entering: Set<string>, gone: MediaTag[]): DiffedTag[] {
  const phaseOf = (t: MediaTag): TagPhase => (entering.has(tagKey(t)) ? 'entering' : 'steady')
  if (gone.length === 0) return tags.map((tag) => ({ tag, phase: phaseOf(tag) }))

  const atIndex = new Map<number, MediaTag[]>()
  for (const ghost of gone) {
    const was = before.findIndex((t) => tagKey(t) === tagKey(ghost))
    const slot = was < 0 ? tags.length : Math.min(was, tags.length)
    atIndex.set(slot, [...(atIndex.get(slot) ?? []), ghost])
  }

  const out: DiffedTag[] = []
  for (let i = 0; i <= tags.length; i += 1) {
    for (const ghost of atIndex.get(i) ?? []) out.push({ tag: ghost, phase: 'leaving' })
    if (i < tags.length) out.push({ tag: tags[i], phase: phaseOf(tags[i]) })
  }
  return out
}

/**
 * @param tags the current set, already sorted by the caller
 * @returns what to render, including tags on their way out
 */
export function useTagDiff(tags: MediaTag[]): DiffedTag[] {
  const [rendered, setRendered] = useState<DiffedTag[]>(() => steady(tags))
  // Touched only inside the effect, never during render.
  const previous = useRef<MediaTag[]>(tags)

  useEffect(() => {
    const before = previous.current
    previous.current = tags

    const beforeKeys = new Set(before.map(tagKey))
    const afterKeys = new Set(tags.map(tagKey))
    const entering = new Set(tags.filter((t) => !beforeKeys.has(tagKey(t))).map(tagKey))
    const gone = before.filter((t) => !afterKeys.has(tagKey(t)))

    if (entering.size === 0 && gone.length === 0) return

    let cancelled = false
    // setState out of the effect BODY, per react-hooks/set-state-in-effect. A
    // microtask still lands the same frame, so nothing flickers first.
    queueMicrotask(() => {
      if (!cancelled) setRendered(withGhosts(tags, before, entering, gone))
    })

    // Settle back to steady once the exit has finished: the ghosts come out of
    // the list and the entering class is dropped so an unrelated re-render
    // cannot restart the entrance animation.
    const settle = setTimeout(() => {
      if (!cancelled) setRendered(steady(tags))
    }, POP_OUT_MS)

    return () => {
      cancelled = true
      clearTimeout(settle)
    }
  }, [tags])

  return rendered
}
