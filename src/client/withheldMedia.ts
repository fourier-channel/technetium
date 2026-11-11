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
//
// AND IT COMES BACK (operator, 2026-11-11: "let's have it pop back in"). A
// withholding is not final: a sensitive tag removed, a post undeleted or let
// out of jail makes the picture the reader's again. Nothing tells this client
// so -- the booru pushes no Matrix state on a plain tag edit -- so a gone
// picture is asked about again on a schedule: a minute after it went, then
// doubling to every fifteen minutes, and only while the tab is visible (a
// hidden tab asks nothing and catches up the moment it is shown). One live
// read each, the same ~157-byte read an image on screen costs, and none at
// all for a picture that never popped. When the booru answers with tags
// again, release() brings it back: 'returning' for POP_MS while it plays the
// pop in reverse, then no phase at all, so a later withholding pops it again.
// ---------------------------------------------------------------------------

export type PopPhase = 'popping' | 'gone' | 'returning'

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

type Schedule = (run: () => void, ms: number) => unknown

/** The booru withheld this image's post from the reader: pop it, then drop it. */
export function withhold(mediaId: string, schedule: Schedule = setTimeout, now: () => number = Date.now): void {
  if (phases.has(mediaId)) return
  phases.set(mediaId, 'popping')
  changed()
  schedule(() => {
    phases.set(mediaId, 'gone')
    gone = new Set([...gone, mediaId])
    rechecks.set(mediaId, { attempt: 0, due: now() + recheckDelay(0) })
    changed()
    armTicker()
  }, POP_MS)
}

/** The booru shows this image's post to the reader again: pop it back in. */
export function release(mediaId: string, schedule: Schedule = setTimeout): void {
  if (phases.get(mediaId) !== 'gone') return
  rechecks.delete(mediaId)
  const next = new Set(gone)
  next.delete(mediaId)
  gone = next
  phases.set(mediaId, 'returning')
  changed()
  schedule(() => {
    // Only if nothing has happened to it since: a picture withheld again
    // while it was coming back is not this timer's to clear.
    if (phases.get(mediaId) !== 'returning') return
    phases.delete(mediaId)
    changed()
  }, POP_MS)
}

// ---------------------------------------------------------------------------
// The rechecks. Pure over an injected clock, so the check can walk the
// schedule; the ticker below is the only part that touches timers and the
// document.
// ---------------------------------------------------------------------------

/** The first recheck, a minute after the pop: long enough that it is not a flicker. */
export const RECHECK_FIRST_MS = 60_000
/** The longest wait between two rechecks of one picture. */
export const RECHECK_MAX_MS = 15 * 60_000
/**
 * The booru shows the post again but the media gate still refuses the image:
 * the gate caches its answer (about 80 s at the longest, fourier-auth plus the
 * Worker), so ask again soon rather than at the next doubling.
 */
export const RECHECK_SOON_MS = 30_000

const rechecks = new Map<string, { attempt: number; due: number }>()

/** How long after a picture's `attempt`th recheck (0: its pop) the next one is due. */
export function recheckDelay(attempt: number): number {
  return Math.min(RECHECK_FIRST_MS * 2 ** attempt, RECHECK_MAX_MS)
}

/**
 * Every gone picture whose recheck is due at `now`, each moved on to its next
 * one. The caller asks the booru about exactly these.
 */
export function dueForRecheck(now: number): string[] {
  const due: string[] = []
  for (const [mediaId, r] of rechecks) {
    if (r.due > now) continue
    due.push(mediaId)
    r.attempt += 1
    r.due = now + recheckDelay(r.attempt)
  }
  return due
}

/** Ask about this gone picture again RECHECK_SOON_MS from `now`, its doubling unchanged. */
export function recheckSoon(mediaId: string, now: number): void {
  const r = rechecks.get(mediaId)
  if (r) r.due = Math.min(r.due, now + RECHECK_SOON_MS)
}

/** When the next recheck of this picture is due, for the check; undefined when none is. */
export function recheckDue(mediaId: string): number | undefined {
  return rechecks.get(mediaId)?.due
}

// The ticker. Wakes every TICK_MS while any picture is gone and asks the
// rechecker about the due ones -- no request at all on a tick with nothing
// due, and no tick at all once nothing is gone. A hidden tab skips its ticks
// and runs one the moment it is shown. Never armed outside a browser.
const TICK_MS = 15_000
let rechecker: ((mediaId: string) => void) | null = null
let ticking = false
let watchingVisibility = false

/** Who asks the booru about a due picture (useMediaTags, which owns the live read). */
export function setRechecker(fn: (mediaId: string) => void): void {
  rechecker = fn
}

function tick(): void {
  if (document.visibilityState !== 'visible' || !rechecker) return
  for (const mediaId of dueForRecheck(Date.now())) rechecker(mediaId)
}

function armTicker(): void {
  if (ticking || typeof document === 'undefined') return
  if (!watchingVisibility) {
    watchingVisibility = true
    document.addEventListener('visibilitychange', () => {
      if (rechecks.size > 0) tick()
    })
  }
  ticking = true
  const loop = () => {
    if (rechecks.size === 0) {
      ticking = false
      return
    }
    tick()
    setTimeout(loop, TICK_MS)
  }
  setTimeout(loop, TICK_MS)
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
